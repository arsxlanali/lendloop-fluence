import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { signEnvelope } from "../lib/signing";
export const claim = internalMutation({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const e = await ctx.db.get(id);
    if (
      !e ||
      e.state === "delivered" ||
      e.state === "failed" ||
      e.leaseUntil > Date.now()
    )
      return null;
    if (e.attempts >= 6) {
      await ctx.db.patch(id, {
        state: "failed",
        error: "Retry budget exhausted",
      });
      return null;
    }
    await ctx.db.patch(id, {
      state: "sending",
      attempts: e.attempts + 1,
      leaseUntil: Date.now() + 60000,
    });
    return { ...e, attempts: e.attempts + 1 };
  },
});
export const settle = internalMutation({
  args: {
    id: v.id("events"),
    attempt: v.number(),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const e = await ctx.db.get(a.id);
    if (!e || e.state !== "sending" || e.attempts !== a.attempt) return;
    await ctx.db.patch(a.id, {
      state: a.ok ? "delivered" : a.attempt >= 6 ? "failed" : "pending",
      error: a.error,
      leaseUntil: a.ok
        ? 0
        : Date.now() + Math.min(300000, 1000 * 2 ** a.attempt),
    });
    if (!a.ok && a.attempt < 6)
      await ctx.scheduler.runAfter(
        Math.min(300000, 1000 * 2 ** a.attempt),
        internal.delivery.send,
        { id: a.id },
      );
  },
});
export const send = internalAction({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const e = await ctx.runMutation(internal.delivery.claim, { id });
    if (!e) return;
    try {
      const secret = process.env.AUTOMATION_SECRET ?? "";
      const url = process.env.N8N_WEBHOOK_URL;
      if (!url) throw new Error("N8N_WEBHOOK_URL is missing");
      const body = await signEnvelope(
        secret,
        JSON.stringify({
          eventId: String(id),
          loanId: String(e.loanId),
          kind: e.kind,
          recipient: e.recipient,
        }),
      );
      const result = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!result.ok) throw new Error(`n8n HTTP ${result.status}`);
      await ctx.runMutation(internal.delivery.settle, {
        id,
        attempt: e.attempts,
        ok: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown delivery failure";
      console.error("automation.delivery.failed", {
        eventId: String(id),
        attempt: e.attempts,
        error: message,
      });
      await ctx.runMutation(internal.delivery.settle, {
        id,
        attempt: e.attempts,
        ok: false,
        error: message.slice(0, 200),
      });
    }
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const state of ["pending", "sending"] as const) {
      const events = await ctx.db
        .query("events")
        .withIndex("state", (q) => q.eq("state", state))
        .take(100);
      for (const e of events)
        if (e.leaseUntil <= Date.now())
          await ctx.scheduler.runAfter(0, internal.delivery.send, {
            id: e._id,
          });
    }
  },
});
export const overdue = internalQuery({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const loans = await ctx.db.query("loans").take(1000);
    return loans
      .filter(
        (l) => l.status === "approved" && l.end < day && l.lastReminder !== day,
      )
      .map((l) => ({ loanId: l._id, recipient: l.borrower, day }));
  },
});
export const remind = internalMutation({
  args: { loanId: v.id("loans"), day: v.string() },
  handler: async (ctx, { loanId, day }) => {
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) throw new Error("Invalid reminder date");
    const l = await ctx.db.get(loanId);
    if (!l || l.status !== "approved" || l.end >= day)
      return { recorded: false };
    const key = `reminder:${loanId}:${day}`;
    const exists = await ctx.db
      .query("activity")
      .withIndex("key", (q) => q.eq("key", key))
      .unique();
    if (exists) return { recorded: false };
    await ctx.db.patch(loanId, { lastReminder: day });
    await ctx.db.insert("activity", {
      loanId,
      kind: "reminder_logged",
      at: Date.now(),
      key,
    });
    return { recorded: true };
  },
});
