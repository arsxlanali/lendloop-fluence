import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { Actor } from "./access";

export const FALLBACK_NAME = "A neighbor";

export async function profile(ctx: QueryCtx, subject: string) {
  return await ctx.db
    .query("users")
    .withIndex("subject", (q) => q.eq("subject", subject))
    .unique();
}

// Copies name and email from the verified Clerk token. Called when the app opens and by every
// mutation that makes someone a party to a loan, so notifications always have a recipient.
export async function rememberProfile(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return;
  const name = (identity.name ?? identity.givenName ?? FALLBACK_NAME).trim().slice(0, 80) || FALLBACK_NAME;
  const email =
    identity.emailVerified !== false && identity.email ? identity.email.slice(0, 254) : undefined;
  const row = await profile(ctx, identity.subject);
  if (!row) await ctx.db.insert("users", { subject: identity.subject, name, email });
  else if (row.name !== name || row.email !== email) await ctx.db.patch(row._id, { name, email });
}

// A tool is out while an approved loan has started and is not confirmed returned, including an
// overdue one. Approved loans never overlap, so the first one by end date (from today) is the
// only one that can cover today.
export async function availability(ctx: QueryCtx, toolId: Id<"tools">, today: string) {
  const overdue = await ctx.db
    .query("loans")
    .withIndex("tool", (q) => q.eq("toolId", toolId).eq("status", "approved").lt("end", today))
    .first();
  if (overdue) return { available: false, overdue: true, until: overdue.end };
  const next = await ctx.db
    .query("loans")
    .withIndex("tool", (q) => q.eq("toolId", toolId).eq("status", "approved").gte("end", today))
    .first();
  if (next && next.start <= today) return { available: false, overdue: false, until: next.end };
  return { available: true, overdue: false, nextBooked: next?.start };
}

export async function isTrusted(ctx: QueryCtx, subject: string) {
  const row = await ctx.db
    .query("trusted")
    .withIndex("subject", (q) => q.eq("subject", subject))
    .unique();
  return row !== null;
}

export async function logActivity(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  kind: string,
  actor: string,
) {
  await ctx.db.insert("activity", { loanId, kind, at: Date.now(), actor });
}

// Records a notification in the outbox, in the same transaction as the change it describes,
// and adds the change to the loan's timeline. Delivery happens afterwards, with retries.
export async function notify(
  ctx: MutationCtx,
  e: {
    loanId?: Id<"loans">;
    toolId?: Id<"tools">;
    kind: string;
    recipient: string;
    actor: string;
    // false: send the notification without adding a line to the loan's history (messages).
    timeline?: boolean;
  },
) {
  const id = await ctx.db.insert("events", {
    loanId: e.loanId,
    toolId: e.toolId,
    kind: e.kind,
    recipient: e.recipient,
    attempts: 0,
    state: "pending",
    leaseUntil: 0,
  });
  if (e.loanId && e.timeline !== false) await logActivity(ctx, e.loanId, e.kind, e.actor);
  await ctx.scheduler.runAfter(0, internal.notify.send, { id });
}

export const readAt = (loan: Doc<"loans">, as: "owner" | "borrower") =>
  (as === "owner" ? loan.ownerReadAt : loan.borrowerReadAt) ?? 0;

// Messages the viewer hasn't read yet on one loan (capped: the badge only needs "a few").
export async function unreadFor(ctx: QueryCtx, loan: Doc<"loans">, me: Actor) {
  const as = loan.owner === me.subject ? "owner" : loan.borrower === me.subject ? "borrower" : null;
  if (!as) return 0;
  const recent = await ctx.db
    .query("messages")
    .withIndex("loan", (q) => q.eq("loanId", loan._id).gt("at", readAt(loan, as)))
    .take(20);
  return recent.filter((m) => m.author !== me.subject).length;
}

// One-line preview of the conversation for the loan card (the request note if nothing newer).
async function lastMessage(ctx: QueryCtx, loan: Doc<"loans">, me: Actor) {
  const m = await ctx.db
    .query("messages")
    .withIndex("loan", (q) => q.eq("loanId", loan._id))
    .order("desc")
    .first();
  const body = m?.body ?? loan.requestNote;
  if (!body) return undefined;
  const mine = m ? m.author === me.subject : loan.borrower === me.subject;
  return { mine, body: body.length > 140 ? `${body.slice(0, 139)}…` : body };
}

export async function audit(ctx: MutationCtx, actor: string, action: string, target: string) {
  await ctx.db.insert("audit", { actor, action, target, at: Date.now() });
}

// What one person may see of a loan. Participants see the other party's name and the notes they
// wrote each other; nobody sees anyone's email. Admins see both names, without the notes.
// With asAdmin, the oversight view: names only, even on the admin's own loans.
export async function loanView(ctx: QueryCtx, loan: Doc<"loans">, viewer: Actor, asAdmin = false) {
  const tool = await ctx.db.get(loan.toolId);
  const role = asAdmin
    ? "admin"
    : loan.owner === viewer.subject
      ? "owner"
      : loan.borrower === viewer.subject
        ? "borrower"
        : "admin";
  const nameOf = async (subject: string) => (await profile(ctx, subject))?.name ?? FALLBACK_NAME;
  const counterpart =
    role === "admin" ? undefined : { name: await nameOf(role === "owner" ? loan.borrower : loan.owner) };
  const activity = await ctx.db
    .query("activity")
    .withIndex("loan", (q) => q.eq("loanId", loan._id))
    .order("desc")
    .take(6);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "Removed listing",
    toolRemoved: !tool || tool.deleted,
    start: loan.start,
    end: loan.end,
    status: loan.status,
    role,
    counterpart,
    ownerName: role === "admin" ? await nameOf(loan.owner) : undefined,
    borrowerName: role === "admin" ? await nameOf(loan.borrower) : undefined,
    // The neighbors' own messages: for the two of them, not for admins.
    requestNote: role === "admin" ? undefined : loan.requestNote,
    handoverNote: role === "admin" ? undefined : loan.handoverNote,
    unread: role === "admin" ? 0 : await unreadFor(ctx, loan, viewer),
    lastMessage: role === "admin" ? undefined : await lastMessage(ctx, loan, viewer),
    returnReported: loan.returnReportedAt !== undefined,
    lastReminder: loan.lastReminder,
    activity: activity.map((a) => ({
      kind: a.kind,
      at: a.at,
      by:
        a.actor === viewer.subject
          ? "you"
          : a.actor === loan.owner
            ? "owner"
            : a.actor === loan.borrower
              ? "borrower"
              : a.actor === "automation" || a.actor === "system"
                ? a.actor
                : "admin",
    })),
  };
}

export type LoanView = Awaited<ReturnType<typeof loanView>>;
