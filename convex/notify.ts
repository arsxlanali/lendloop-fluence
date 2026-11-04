import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin } from "./access";
import { audit, FALLBACK_NAME, logActivity, profile } from "./model";
import { tokenForN8n } from "../lib/signing";

export const MAX_ATTEMPTS = 6;
const LEASE_MS = 60_000;
const backoff = (attempt: number) => Math.min(300_000, 1000 * 2 ** attempt);

// Takes the event for one delivery attempt. The lease stops a second worker sending it at the
// same time; the attempt number lets settle() ignore a late answer from an older attempt.
export const claim = internalMutation({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const e = await ctx.db.get(id);
    if (!e || e.state === "delivered" || e.state === "failed" || e.leaseUntil > Date.now())
      return null;
    if (e.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(id, { state: "failed", error: e.error ?? "Retry budget exhausted" });
      if (e.loanId && e.kind !== "message") await logActivity(ctx, e.loanId, "notification_failed", "automation");
      return null;
    }
    await ctx.db.patch(id, {
      state: "sending",
      attempts: e.attempts + 1,
      leaseUntil: Date.now() + LEASE_MS,
    });
    return { attempts: e.attempts + 1 };
  },
});

// Only the fields the notification needs: who to tell (name, email), what happened, which tool
// and the dates. No descriptions, no IDs of other people, nothing about the other party.
export const message = internalQuery({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const e = await ctx.db.get(id);
    if (!e) return null;
    const loan = e.loanId ? await ctx.db.get(e.loanId) : null;
    const tool = await ctx.db.get(loan?.toolId ?? e.toolId!);
    const recipient = await profile(ctx, e.recipient);
    return {
      eventId: id,
      kind: e.kind,
      recipient: { name: recipient?.name ?? FALLBACK_NAME, email: recipient?.email ?? null },
      tool: { name: tool?.name ?? "a removed listing" },
      loan: loan ? { start: loan.start, end: loan.end } : null,
    };
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
    if (a.ok) {
      await ctx.db.patch(a.id, { state: "delivered", error: undefined, leaseUntil: 0 });
      if (e.loanId && e.kind !== "message") await logActivity(ctx, e.loanId, "notification_sent", "automation");
      return;
    }
    if (a.attempt >= MAX_ATTEMPTS) {
      await ctx.db.patch(a.id, { state: "failed", error: a.error, leaseUntil: 0 });
      if (e.loanId && e.kind !== "message") await logActivity(ctx, e.loanId, "notification_failed", "automation");
      return;
    }
    const wait = backoff(a.attempt);
    await ctx.db.patch(a.id, { state: "pending", error: a.error, leaseUntil: Date.now() + wait });
    await ctx.scheduler.runAfter(wait, internal.notify.send, { id: a.id });
  },
});

export const send = internalAction({
  args: { id: v.id("events") },
  handler: async (ctx, { id }) => {
    const claimed = await ctx.runMutation(internal.notify.claim, { id });
    if (!claimed) return;
    try {
      const secret = process.env.AUTOMATION_SECRET ?? "";
      const url = process.env.N8N_WEBHOOK_URL;
      if (!url) throw new Error("N8N_WEBHOOK_URL is not set");
      const msg = await ctx.runQuery(internal.notify.message, { id });
      if (!msg) return;
      const payload = JSON.stringify(msg);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await tokenForN8n(secret, payload, id)}`,
        },
        body: JSON.stringify({ payload }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`n8n answered HTTP ${response.status}`);
      await ctx.runMutation(internal.notify.settle, { id, attempt: claimed.attempts, ok: true });
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Unknown delivery failure").slice(0, 200);
      // Event ID and attempt only: no names, emails or payloads in logs.
      console.error("automation.delivery.failed", { eventId: id, attempt: claimed.attempts, message });
      await ctx.runMutation(internal.notify.settle, {
        id,
        attempt: claimed.attempts,
        ok: false,
        error: message,
      });
    }
  },
});

// Every minute: restart deliveries whose lease ran out (a crashed action, a lost schedule).
// The index range picks only due events, so waiting ones can never starve due ones.
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const state of ["pending", "sending"] as const) {
      const due = await ctx.db
        .query("events")
        .withIndex("state", (q) => q.eq("state", state).lte("leaseUntil", now))
        .take(100);
      for (const e of due) await ctx.scheduler.runAfter(0, internal.notify.send, { id: e._id });
    }
  },
});

// Admin view of everything automation could not do, grouped: the same failure repeated is
// one row with a count, newest first.
export const failures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const events = await ctx.db
      .query("events")
      .withIndex("state", (q) => q.eq("state", "failed"))
      .take(200);
    const runs = await ctx.db
      .query("automationFailures")
      .withIndex("open", (q) => q.eq("resolvedAt", undefined))
      .order("desc")
      .take(200);
    const group = <T, K extends string>(rows: T[], key: (r: T) => K, at: (r: T) => number) => {
      const map = new Map<K, { first: T; count: number; latestAt: number }>();
      for (const r of rows) {
        const g = map.get(key(r));
        if (g) {
          g.count++;
          g.latestAt = Math.max(g.latestAt, at(r));
        } else map.set(key(r), { first: r, count: 1, latestAt: at(r) });
      }
      return [...map.values()].sort((a, b) => b.latestAt - a.latestAt);
    };
    return {
      deliveries: group(events, (e) => `${e.kind}|${e.error ?? ""}` as string, (e) => e._creationTime).map((g) => ({
        kind: g.first.kind,
        error: g.first.error ?? "",
        count: g.count,
        latestAt: g.latestAt,
      })),
      runs: group(runs, (r) => `${r.workflow}|${r.node}|${r.message}` as string, (r) => r.at).map((g) => ({
        workflow: g.first.workflow,
        node: g.first.node,
        message: g.first.message,
        count: g.count,
        latestAt: g.latestAt,
      })),
    };
  },
});

// After fixing the cause: send every failed notification again (up to 100 at a time).
export const retryAll = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireAdmin(ctx);
    const failed = await ctx.db
      .query("events")
      .withIndex("state", (q) => q.eq("state", "failed"))
      .take(100);
    for (const e of failed) {
      await ctx.db.patch(e._id, { state: "pending", attempts: 0, leaseUntil: 0, error: undefined });
      await ctx.scheduler.runAfter(0, internal.notify.send, { id: e._id });
    }
    await audit(ctx, me.subject, "notifications.retried", String(failed.length));
    return failed.length;
  },
});

// Mark one group of workflow failures as handled. Kept in the table, hidden from the panel.
export const dismissRuns = mutation({
  args: { workflow: v.string(), node: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    const me = await requireAdmin(ctx);
    const open = await ctx.db
      .query("automationFailures")
      .withIndex("open", (q) => q.eq("resolvedAt", undefined))
      .filter((q) =>
        q.and(q.eq(q.field("workflow"), a.workflow), q.eq(q.field("node"), a.node), q.eq(q.field("message"), a.message)),
      )
      .take(500);
    const now = Date.now();
    for (const r of open) await ctx.db.patch(r._id, { resolvedAt: now });
    await audit(ctx, me.subject, "workflow-failures.dismissed", `${a.workflow}: ${open.length}`);
    return open.length;
  },
});

// A free-plan n8n host sleeps after a quiet spell, and a sleeping n8n misses its own schedule
// (the daily overdue reminders). A light health check every 10 minutes keeps it awake.
export const keepAutomationAwake = internalAction({
  args: {},
  handler: async () => {
    const url = process.env.N8N_WEBHOOK_URL;
    if (!url) return;
    try {
      await fetch(new URL("/healthz", url), { signal: AbortSignal.timeout(20_000) });
    } catch {
      // A missed check only means n8n may sleep until the next one; deliveries retry on their own.
    }
  },
});
