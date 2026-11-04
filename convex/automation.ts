// Called only from the signed HTTP routes in http.ts (n8n -> Convex).
import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { FALLBACK_NAME, logActivity, profile } from "./model";
import { addDays, daysBetween, utcToday } from "../lib/policy";

const CLAIM_LEASE_MS = 30 * 60_000;
// A failed reminder is not handed out again within the same daily run; an operator re-running
// the workflow after this delay (or tomorrow's run) retries it.
export const RETRY_DELAY_MS = 15 * 60_000;
export const MAX_REMINDER_ATTEMPTS = 3;
export const BATCH = 100;
const SCAN_LIMIT = 1000;

// Overdue loans whose borrower should get today's reminder, oldest due date first. A borrower
// who reported the return isn't chased while the owner checks; if the owner disputes the
// report, the loan comes back here.
function overdue(ctx: MutationCtx, day: string) {
  return ctx.db
    .query("loans")
    .withIndex("statusEnd", (q) => q.eq("status", "approved").lt("end", day))
    .filter((q) =>
      q.and(q.neq(q.field("lastReminder"), day), q.eq(q.field("returnReportedAt"), undefined)),
    );
}

async function reminderRow(ctx: MutationCtx, loan: Doc<"loans">, day: string) {
  return await ctx.db
    .query("reminders")
    .withIndex("loanDay", (q) => q.eq("loanId", loan._id).eq("day", day))
    .unique();
}

function claimable(row: Doc<"reminders"> | null, now: number) {
  return !row || (row.state !== "sent" && row.leaseUntil <= now && row.attempts < MAX_REMINDER_ATTEMPTS);
}

// Claims up to BATCH overdue loans for today's reminder and returns what each message needs.
// A claimed loan is not handed out again until it is reported or its lease runs out, so
// overlapping runs or a retried request cannot send the same reminder twice.
export const claimReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const day = utcToday();
    const now = Date.now();
    const claimed = [];
    let scanned = 0;
    for await (const loan of overdue(ctx, day)) {
      if (claimed.length >= BATCH || ++scanned > SCAN_LIMIT) break;
      const row = await reminderRow(ctx, loan, day);
      if (!claimable(row, now)) continue;
      const lease = { state: "claimed" as const, leaseUntil: now + CLAIM_LEASE_MS };
      if (row) await ctx.db.patch(row._id, { ...lease, attempts: row.attempts + 1 });
      else await ctx.db.insert("reminders", { loanId: loan._id, day, ...lease, attempts: 1 });
      const borrower = await profile(ctx, loan.borrower);
      const tool = await ctx.db.get(loan.toolId);
      claimed.push({
        loanId: loan._id,
        day,
        idempotencyKey: `reminder:${loan._id}:${day}`,
        recipient: { name: borrower?.name ?? FALLBACK_NAME, email: borrower?.email ?? null },
        tool: { name: tool?.name ?? "a removed listing" },
        dueDate: loan.end,
        daysOverdue: daysBetween(loan.end, day),
      });
    }
    return { day, reminders: claimed };
  },
});

// Records what happened to each claimed reminder; repeating a report changes nothing. The
// answer tells the workflow whether to claim another batch and whether today has failures.
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
    const now = Date.now();
    let recorded = 0;
    for (const r of results.slice(0, BATCH)) {
      // A run that crosses midnight UTC can still report yesterday's claims.
      if (r.day !== today && r.day !== addDays(today, -1)) continue;
      const loan = await ctx.db.get(r.loanId);
      const row = loan && (await reminderRow(ctx, loan, r.day));
      if (!row || row.state !== "claimed") continue;
      const sent = r.status === "sent";
      await ctx.db.patch(row._id, {
        state: r.status,
        leaseUntil: sent ? 0 : now + RETRY_DELAY_MS,
        error: sent ? undefined : (r.error ?? "Unknown error").slice(0, 200),
      });
      if (sent) await ctx.db.patch(r.loanId, { lastReminder: r.day });
      await logActivity(ctx, r.loanId, sent ? "reminder_sent" : "reminder_failed", "automation");
      recorded++;
    }
    let more = false;
    let scanned = 0;
    for await (const loan of overdue(ctx, today)) {
      if (++scanned > SCAN_LIMIT) break;
      if (claimable(await reminderRow(ctx, loan, today), now)) {
        more = true;
        break;
      }
    }
    const failedToday = (
      await ctx.db
        .query("reminders")
        .withIndex("dayState", (q) => q.eq("day", today).eq("state", "failed"))
        .take(1000)
    ).length;
    return { recorded, more, failedToday };
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
