import { internalMutation, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { actor, requireAdmin, requireThat } from "./access";
import { loanView, notify, rememberProfile } from "./model";
import { loanStatus } from "./schema";
import {
  addDays,
  checkClientToday,
  cleanText,
  LIMITS,
  overlaps,
  utcToday,
  validateDates,
} from "../lib/policy";

export const requestLoan = mutation({
  args: {
    toolId: v.id("tools"),
    start: v.string(),
    end: v.string(),
    today: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = await actor(ctx);
    validateDates(a.start, a.end, checkClientToday(a.today));
    const note = cleanText(a.note ?? "", LIMITS.noteLength, "Message", false);
    await rememberProfile(ctx);
    const t = await ctx.db.get(a.toolId);
    requireThat(t && !t.deleted, "That listing is no longer available.");
    requireThat(t.owner !== me.subject, "You can't borrow your own tool.");
    const pending = await ctx.db
      .query("loans")
      .withIndex("borrowerStatus", (q) => q.eq("borrower", me.subject).eq("status", "pending"))
      .take(LIMITS.pendingRequestsPerBorrower);
    requireThat(
      pending.length < LIMITS.pendingRequestsPerBorrower,
      `You can have at most ${LIMITS.pendingRequestsPerBorrower} open requests. Cancel one first.`,
    );
    requireThat(
      !pending.some((l) => l.toolId === a.toolId && overlaps(a.start, a.end, l.start, l.end)),
      "You already asked for these dates.",
    );
    const booked = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", a.toolId).eq("status", "approved").gte("end", a.start))
      .collect();
    requireThat(
      !booked.some((l) => overlaps(a.start, a.end, l.start, l.end)),
      "Those dates are already booked.",
    );
    const id = await ctx.db.insert("loans", {
      toolId: a.toolId,
      start: a.start,
      end: a.end,
      owner: t.owner,
      borrower: me.subject,
      status: "pending",
      requestNote: note || undefined,
    });
    await notify(ctx, { loanId: id, kind: "requested", recipient: t.owner, actor: me.subject });
    return id;
  },
});

export const cancelRequest = mutation({
  args: { id: v.id("loans") },
  handler: async (ctx, { id }) => {
    const me = await actor(ctx);
    const l = await ctx.db.get(id);
    requireThat(l && l.borrower === me.subject, "You can only cancel your own requests.");
    requireThat(l.status === "pending", "This request has already been answered.");
    await ctx.db.patch(id, { status: "cancelled" });
    await notify(ctx, { loanId: id, kind: "cancelled", recipient: l.owner, actor: me.subject });
  },
});

export const decide = mutation({
  args: {
    id: v.id("loans"),
    approve: v.boolean(),
    today: v.string(),
    // Hand-over details for the borrower (where, when). Only used when approving.
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, approve, today, note }) => {
    const me = await actor(ctx);
    checkClientToday(today);
    const handoverNote = cleanText(note ?? "", LIMITS.noteLength, "Message", false);
    const l = await ctx.db.get(id);
    requireThat(l && l.owner === me.subject, "You can only answer requests for your own tools.");
    requireThat(l.status === "pending", "This request has already been answered.");
    if (!approve) {
      await ctx.db.patch(id, { status: "declined" });
      await notify(ctx, { loanId: id, kind: "declined", recipient: l.borrower, actor: me.subject });
      return;
    }
    const t = await ctx.db.get(l.toolId);
    requireThat(t && !t.deleted, "This listing was removed.");
    requireThat(l.end >= today, "The dates of this request have passed.");
    const booked = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", l.toolId).eq("status", "approved").gte("end", l.start))
      .collect();
    requireThat(
      !booked.some((x) => overlaps(l.start, l.end, x.start, x.end)),
      "Another approved loan overlaps these dates.",
    );
    await ctx.db.patch(id, { status: "approved", handoverNote: handoverNote || undefined });
    await notify(ctx, { loanId: id, kind: "approved", recipient: l.borrower, actor: me.subject });
    // Requests for the same dates can no longer be met: answer them now instead of leaving
    // those neighbors waiting.
    const others = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", l.toolId).eq("status", "pending").gte("end", l.start))
      .collect();
    for (const o of others)
      if (overlaps(l.start, l.end, o.start, o.end)) {
        await ctx.db.patch(o._id, { status: "declined" });
        await notify(ctx, { loanId: o._id, kind: "declined", recipient: o.borrower, actor: me.subject });
      }
  },
});

// The borrower says the tool is back. The loan stays open (and the tool unavailable) until the
// owner confirms. Overdue reminders pause meanwhile; if the owner says it isn't back
// (disputeReturn), they resume, so a false report cannot silence them.
export const reportReturn = mutation({
  args: { id: v.id("loans"), today: v.string() },
  handler: async (ctx, { id, today }) => {
    const me = await actor(ctx);
    checkClientToday(today);
    const l = await ctx.db.get(id);
    requireThat(l && l.borrower === me.subject, "You can only report returns for your own loans.");
    requireThat(l.status === "approved", "This loan is not active.");
    requireThat(l.start <= today, "This loan hasn't started yet. Cancel the booking instead.");
    requireThat(l.returnReportedAt === undefined, "You already reported this return.");
    await ctx.db.patch(id, { returnReportedAt: Date.now() });
    await notify(ctx, { loanId: id, kind: "return_reported", recipient: l.owner, actor: me.subject });
  },
});

export const disputeReturn = mutation({
  args: { id: v.id("loans") },
  handler: async (ctx, { id }) => {
    const me = await actor(ctx);
    const l = await ctx.db.get(id);
    requireThat(l && l.owner === me.subject, "Only the owner can answer a reported return.");
    requireThat(l.status === "approved" && l.returnReportedAt !== undefined, "No return to answer.");
    await ctx.db.patch(id, { returnReportedAt: undefined });
    await notify(ctx, { loanId: id, kind: "return_disputed", recipient: l.borrower, actor: me.subject });
  },
});

export const confirmReturn = mutation({
  args: { id: v.id("loans"), today: v.string() },
  handler: async (ctx, { id, today }) => {
    const me = await actor(ctx);
    checkClientToday(today);
    const l = await ctx.db.get(id);
    requireThat(l && l.owner === me.subject, "Only the owner can confirm a return.");
    requireThat(l.status === "approved", "This loan is not active.");
    requireThat(l.start <= today, "This loan hasn't started yet. Cancel the booking instead.");
    await ctx.db.patch(id, { status: "returned" });
    await notify(ctx, { loanId: id, kind: "returned", recipient: l.borrower, actor: me.subject });
  },
});

// Either party can call off an approved loan before it starts; the other one is told.
export const cancelBooking = mutation({
  args: { id: v.id("loans"), today: v.string() },
  handler: async (ctx, { id, today }) => {
    const me = await actor(ctx);
    checkClientToday(today);
    const l = await ctx.db.get(id);
    requireThat(l && (l.owner === me.subject || l.borrower === me.subject), "You can only cancel your own bookings.");
    requireThat(l.status === "approved", "Only approved bookings can be cancelled.");
    requireThat(l.start > today, "This loan has started. Mark it returned instead.");
    await ctx.db.patch(id, { status: "cancelled" });
    const other = l.owner === me.subject ? l.borrower : l.owner;
    await notify(ctx, { loanId: id, kind: "booking_cancelled", recipient: other, actor: me.subject });
  },
});

// Open loans by status for one side (at most 50: open requests and bookings are bounded).
export const byStatus = query({
  args: { as: v.union(v.literal("owner"), v.literal("borrower")), status: loanStatus },
  handler: async (ctx, { as, status }) => {
    const me = await actor(ctx);
    const loans = await (as === "owner"
      ? ctx.db.query("loans").withIndex("ownerStatus", (q) => q.eq("owner", me.subject).eq("status", status))
      : ctx.db.query("loans").withIndex("borrowerStatus", (q) => q.eq("borrower", me.subject).eq("status", status))
    )
      .order("desc")
      .take(50);
    return await Promise.all(loans.map((l) => loanView(ctx, l, me)));
  },
});

export const myRequests = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await actor(ctx);
    const result = await ctx.db
      .query("loans")
      .withIndex("borrower", (q) => q.eq("borrower", me.subject))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((l) => loanView(ctx, l, me))) };
  },
});

export const incoming = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await actor(ctx);
    const result = await ctx.db
      .query("loans")
      .withIndex("owner", (q) => q.eq("owner", me.subject))
      .order("desc")
      .paginate(paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((l) => loanView(ctx, l, me))) };
  },
});

// What waits for the owner: new requests and returns to confirm.
export const needsAnswer = query({
  args: {},
  handler: async (ctx) => {
    const me = await actor(ctx);
    const pending = await ctx.db
      .query("loans")
      .withIndex("ownerStatus", (q) => q.eq("owner", me.subject).eq("status", "pending"))
      .take(50);
    const returns = await ctx.db
      .query("loans")
      .withIndex("ownerStatus", (q) => q.eq("owner", me.subject).eq("status", "approved"))
      .filter((q) => q.neq(q.field("returnReportedAt"), undefined))
      .take(50);
    return await Promise.all([...returns, ...pending].map((l) => loanView(ctx, l, me)));
  },
});

export const adminLoans = query({
  args: { status: v.optional(loanStatus), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { status, paginationOpts }) => {
    const me = await requireAdmin(ctx);
    const loans = status
      ? ctx.db.query("loans").withIndex("statusEnd", (q) => q.eq("status", status))
      : ctx.db.query("loans");
    const result = await loans.order("desc").paginate(paginationOpts);
    return { ...result, page: await Promise.all(result.page.map((l) => loanView(ctx, l, me, true))) };
  },
});

// Hourly: requests whose last day has passed everywhere on Earth are closed as expired, so
// nobody waits on them forever. Drains in batches.
export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = addDays(utcToday(), -1);
    const stale = await ctx.db
      .query("loans")
      .withIndex("statusEnd", (q) => q.eq("status", "pending").lt("end", cutoff))
      .take(200);
    for (const l of stale) {
      await ctx.db.patch(l._id, { status: "expired" });
      await notify(ctx, { loanId: l._id, kind: "expired", recipient: l.borrower, actor: "system" });
    }
    if (stale.length === 200) await ctx.scheduler.runAfter(0, internal.loans.expireStale, {});
  },
});
