// Conversation helpers shared by messages.ts, loans.ts and model.notify. No public functions here.
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// Loan changes that appear as a line in the conversation between owner and borrower.
export const LOAN_EVENTS = new Set([
  "requested",
  "approved",
  "declined",
  "cancelled",
  "expired",
  "return_reported",
  "return_disputed",
  "returned",
  "booking_cancelled",
]);

export async function findConversation(ctx: QueryCtx, toolId: Id<"tools">, borrower: string) {
  return await ctx.db
    .query("conversations")
    .withIndex("pair", (q) => q.eq("toolId", toolId).eq("borrower", borrower))
    .unique();
}

export async function inboxRow(ctx: QueryCtx, conversationId: Id<"conversations">, subject: string) {
  return await ctx.db
    .query("inbox")
    .withIndex("conversation", (q) => q.eq("conversationId", conversationId).eq("subject", subject))
    .unique();
}

// The conversation between a tool's owner and one borrower, created (with both inbox rows) on
// first contact: a question or a request.
export async function openConversation(ctx: MutationCtx, tool: Doc<"tools">, borrower: string) {
  const existing = await findConversation(ctx, tool._id, borrower);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("conversations", {
    toolId: tool._id,
    owner: tool.owner,
    borrower,
    lastMessageAt: now,
  });
  for (const [subject, role] of [
    [tool.owner, "owner"],
    [borrower, "borrower"],
  ] as const)
    await ctx.db.insert("inbox", { subject, conversationId: id, role, lastMessageAt: now, unread: 0 });
  return (await ctx.db.get(id))!;
}

// Adds a message (or a system line) and updates both inbox rows: the recipient gets one more
// unread, the author has seen everything. Returns whether the recipient already had unread
// messages (then no new notification is needed).
export async function post(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  message: { author: string; body: string; event?: string; eventLoanId?: Id<"loans"> },
  recipient: string,
) {
  const at = Date.now();
  await ctx.db.insert("messages", { conversationId: conversation._id, at, ...message });
  await ctx.db.patch(conversation._id, { lastMessageAt: at });
  let hadUnread = false;
  for (const subject of [conversation.owner, conversation.borrower]) {
    const row = await inboxRow(ctx, conversation._id, subject);
    if (!row) continue;
    if (subject === recipient) {
      hadUnread = row.unread > 0;
      await ctx.db.patch(row._id, { lastMessageAt: at, unread: row.unread + 1 });
    } else await ctx.db.patch(row._id, { lastMessageAt: at, unread: 0 });
  }
  return { hadUnread };
}

// A loan change, as a line in the conversation ("Sam requested Nov 5 - 7").
export async function postLoanEvent(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  kind: string,
  actor: string,
  recipient: string,
) {
  const loan = await ctx.db.get(loanId);
  const tool = loan && (await ctx.db.get(loan.toolId));
  if (!loan || !tool) return;
  const conversation = await openConversation(ctx, tool, loan.borrower);
  await post(ctx, conversation, { author: actor, body: "", event: kind, eventLoanId: loanId }, recipient);
}

// Blocking is per person, in either direction, and covers every item.
export async function blockBetween(ctx: QueryCtx, me: string, other: string) {
  const mine = await ctx.db
    .query("blocks")
    .withIndex("pair", (q) => q.eq("blocker", me).eq("blocked", other))
    .unique();
  const theirs = await ctx.db
    .query("blocks")
    .withIndex("pair", (q) => q.eq("blocker", other).eq("blocked", me))
    .unique();
  return { iBlocked: mine, theyBlocked: theirs !== null };
}

// Last text message, for previews (system lines are skipped).
export async function lastText(ctx: QueryCtx, conversationId: Id<"conversations">) {
  const recent = await ctx.db
    .query("messages")
    .withIndex("conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .take(10);
  return recent.find((m) => !m.event) ?? null;
}
