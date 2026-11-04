// Called only from the signed HTTP routes in http.ts (n8n -> Convex).
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { FALLBACK_NAME, logActivity, profile } from "./model";
import { addDays, daysBetween, utcToday } from "../lib/policy";

const CLAIM_LEASE_MS = 30 * 60_000;
export const MAX_REMINDER_ATTEMPTS = 3;

// Claims up to `limit` overdue loans for today's reminder and returns what the message needs.
// A claimed loan is not handed out again until it is reported or its lease runs out, so
// overlapping runs or a retried request cannot send the same reminder twice.
// A borrower who reported the return is not chased; the owner is asked to confirm instead.
export const claimReminders = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const day = utcToday();
    const now = Date.now();
    const max = Math.min(Math.max(1, Math.floor(limit)), 200);
    const candidates = ctx.db
      .query("loans")
      .withIndex("statusEnd", (q) => q.eq("status", "approved").lt("end", day))
      .filter((q) => q.neq(q.field("lastReminder"), day));
    const claimed = [];
    let scanned = 0;
    // Loans already claimed by another run are skipped without using up the batch.
    for await (const loan of candidates) {
      if (claimed.length >= max || ++scanned > 1000) break;
      const row = await ctx.db
        .query("reminders")
        .withIndex("loanDay", (q) => q.eq("loanId", loan._id).eq("day", day))
        .unique();
      if (row && (row.state === "sent" || row.leaseUntil > now || row.attempts >= MAX_REMINDER_ATTEMPTS))
        continue;
      if (row)
        await ctx.db.patch(row._id, { state: "claimed", leaseUntil: now + CLAIM_LEASE_MS, attempts: row.attempts + 1 });
      else
        await ctx.db.insert("reminders", { loanId: loan._id, day, state: "claimed", leaseUntil: now + CLAIM_LEASE_MS, attempts: 1 });
      const ownerAsked = loan.returnReportedAt !== undefined;
      const person = await profile(ctx, ownerAsked ? loan.owner : loan.borrower);
      const tool = await ctx.db.get(loan.toolId);
      claimed.push({
        loanId: loan._id,
        day,
        idempotencyKey: `reminder:${loan._id}:${day}`,
        kind: ownerAsked ? "confirm_return" : "overdue",
        recipient: { name: person?.name ?? FALLBACK_NAME, email: person?.email ?? null },
        tool: { name: tool?.name ?? "a removed listing" },
        dueDate: loan.end,
        daysOverdue: daysBetween(loan.end, day),
      });
    }
    return { day, reminders: claimed };
  },
});

// Records what happened to each claimed reminder. Repeating a report changes nothing.
export const reportReminders = internalMutation({
  args: {
    results: v.array(
      v.object({
        loanId: v.id("loans"),
        day: v.string(),
        status: v.union(v.literal("sent"), v.literal("failed")),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { results }) => {
    const today = utcToday();
    let recorded = 0;
    for (const r of results.slice(0, 200)) {
      // A run that crosses midnight UTC can still report yesterday's claims.
      if (r.day !== today && r.day !== addDays(today, -1)) continue;
      const row = await ctx.db
        .query("reminders")
        .withIndex("loanDay", (q) => q.eq("loanId", r.loanId).eq("day", r.day))
        .unique();
      if (!row || row.state !== "claimed") continue;
      await ctx.db.patch(row._id, {
        state: r.status,
        leaseUntil: 0,
        error: r.status === "failed" ? (r.error ?? "Unknown error").slice(0, 200) : undefined,
      });
      if (r.status === "sent") await ctx.db.patch(r.loanId, { lastReminder: r.day });
      await logActivity(ctx, r.loanId, r.status === "sent" ? "reminder_sent" : "reminder_failed", "automation");
      recorded++;
    }
    return { recorded };
  },
});

// The n8n error workflow reports failed executions here so admins see them in the app.
export const recordFailure = internalMutation({
  args: {
    executionId: v.string(),
    workflow: v.string(),
    node: v.string(),
    message: v.string(),
  },
  handler: async (ctx, a) => {
    const executionId = a.executionId.slice(0, 64);
    const seen = await ctx.db
      .query("automationFailures")
      .withIndex("execution", (q) => q.eq("executionId", executionId))
      .unique();
    if (seen) return { recorded: false };
    await ctx.db.insert("automationFailures", {
      executionId,
      workflow: a.workflow.slice(0, 100),
      node: a.node.slice(0, 100),
      message: a.message.slice(0, 300),
      at: Date.now(),
    });
    return { recorded: true };
  },
});
