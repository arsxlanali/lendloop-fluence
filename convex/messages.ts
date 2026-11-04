import { mutation, query, type QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { actor, requireThat, type Actor } from "./access";
import { FALLBACK_NAME, notify, profile, rememberProfile } from "./model";
import { blockBetween, findConversation, inboxRow, lastText, openConversation, post } from "./chat";
import { cleanText, LIMITS } from "../lib/policy";

const SHOWN = 100;

export type ThreadMessage = {
  _id: string;
  body: string;
  at: number;
  by: "me" | "them" | "system";
  event: string | null;
  dates: { start: string; end: string } | null;
};
const NEW_CONVERSATIONS_PER_DAY = 20;
const nameOf = async (ctx: QueryCtx, subject: string) => (await profile(ctx, subject))?.name ?? FALLBACK_NAME;

// Only the owner and the borrower of a conversation, never admins: it is theirs.
async function participant(ctx: QueryCtx, id: Id<"conversations">, me: Actor) {
  const c = await ctx.db.get(id);
  if (!c || (c.owner !== me.subject && c.borrower !== me.subject))
    throw new ConvexError("Only the two people in this conversation can see it.");
  return c;
}

// Writable while the listing is up, or while the two of them still have an open loan for it,
// and nobody has blocked the other.
async function openState(ctx: QueryCtx, c: Doc<"conversations">, me: string) {
  const other = c.owner === me ? c.borrower : c.owner;
  const block = await blockBetween(ctx, me, other);
  if (block.iBlocked) return { open: false, reason: "blocked-by-me" as const };
  if (block.theyBlocked) return { open: false, reason: "blocked" as const };
  const tool = await ctx.db.get(c.toolId);
  if (tool && !tool.deleted) return { open: true, reason: null };
  for (const status of ["pending", "approved"] as const) {
    const loan = await ctx.db
      .query("loans")
      .withIndex("borrowerStatus", (q) => q.eq("borrower", c.borrower).eq("status", status))
      .filter((q) => q.eq(q.field("toolId"), c.toolId))
      .first();
    if (loan) return { open: true, reason: null };
  }
  return { open: false, reason: "removed" as const };
}

// The Messages tab: every conversation, as owner and as borrower, newest first.
export const inbox = query({
  args: {
    role: v.optional(v.union(v.literal("owner"), v.literal("borrower"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { role, paginationOpts }) => {
    const me = await actor(ctx);
    const rows = role
      ? ctx.db.query("inbox").withIndex("roleRecent", (q) => q.eq("subject", me.subject).eq("role", role))
      : ctx.db.query("inbox").withIndex("recent", (q) => q.eq("subject", me.subject));
    const result = await rows.order("desc").paginate(paginationOpts);
    const page = await Promise.all(
      result.page.map(async (row) => {
        const c = (await ctx.db.get(row.conversationId))!;
        const tool = await ctx.db.get(c.toolId);
        const last = await lastText(ctx, c._id);
        return {
          _id: c._id,
          role: row.role,
          unread: row.unread,
          lastMessageAt: row.lastMessageAt,
          toolName: tool?.name ?? "Removed listing",
          otherName: await nameOf(ctx, row.role === "owner" ? c.borrower : c.owner),
          preview: last ? { mine: last.author === me.subject, body: last.body.slice(0, 120) } : null,
        };
      }),
    );
    return { ...result, page };
  },
});

// One conversation by id, or, before the first message, the would-be conversation about a tool.
export const conversation = query({
  args: { conversationId: v.optional(v.id("conversations")), toolId: v.optional(v.id("tools")) },
  handler: async (ctx, { conversationId, toolId }) => {
    const me = await actor(ctx);
    let c: Doc<"conversations"> | null = null;
    if (conversationId) c = await participant(ctx, conversationId, me);
    else if (toolId) {
      const tool = await ctx.db.get(toolId);
      if (!tool || tool.deleted) throw new ConvexError("That listing is no longer available.");
      if (tool.owner === me.subject) throw new ConvexError("This is your own listing.");
      c = await findConversation(ctx, toolId, me.subject);
      if (!c) {
        const block = await blockBetween(ctx, me.subject, tool.owner);
        return {
          conversationId: null,
          toolId,
          toolName: tool.name,
          role: "borrower" as const,
          otherName: await nameOf(ctx, tool.owner),
          open: !block.iBlocked && !block.theyBlocked,
          reason: block.iBlocked ? ("blocked-by-me" as const) : block.theyBlocked ? ("blocked" as const) : null,
          unread: 0,
          loan: null,
          messages: [] as ThreadMessage[],
        };
      }
    } else throw new ConvexError("Choose a conversation.");
    const role = c.owner === me.subject ? ("owner" as const) : ("borrower" as const);
    const tool = await ctx.db.get(c.toolId);
    const newest = await ctx.db
      .query("messages")
      .withIndex("conversation", (q) => q.eq("conversationId", c._id))
      .order("desc")
      .take(SHOWN);
    const loanDates = new Map<string, { start: string; end: string }>();
    for (const m of newest)
      if (m.eventLoanId && !loanDates.has(m.eventLoanId)) {
        const l = await ctx.db.get(m.eventLoanId);
        if (l) loanDates.set(m.eventLoanId, { start: l.start, end: l.end });
      }
    const latestLoan = await ctx.db
      .query("loans")
      .withIndex("borrower", (q) => q.eq("borrower", c.borrower))
      .order("desc")
      .filter((q) => q.eq(q.field("toolId"), c.toolId))
      .first();
    const state = await openState(ctx, c, me.subject);
    return {
      conversationId: c._id,
      toolId: c.toolId,
      toolName: tool?.name ?? "Removed listing",
      role,
      otherName: await nameOf(ctx, role === "owner" ? c.borrower : c.owner),
      open: state.open,
      reason: state.reason,
      unread: (await inboxRow(ctx, c._id, me.subject))?.unread ?? 0,
      loan: latestLoan
        ? {
            status: latestLoan.status,
            start: latestLoan.start,
            end: latestLoan.end,
            returnReported: latestLoan.returnReportedAt !== undefined,
          }
        : null,
      messages: newest.reverse().map((m): ThreadMessage => ({
        _id: m._id as string,
        body: m.body,
        at: m.at,
        by: m.author === me.subject ? ("me" as const) : m.author === "system" ? ("system" as const) : ("them" as const),
        event: m.event ?? null,
        dates: m.eventLoanId ? (loanDates.get(m.eventLoanId) ?? null) : null,
      })),
    };
  },
});

// Send a message. Without a conversation id, the first message about a tool starts one.
export const send = mutation({
  args: { conversationId: v.optional(v.id("conversations")), toolId: v.optional(v.id("tools")), body: v.string() },
  handler: async (ctx, { conversationId, toolId, body }) => {
    const me = await actor(ctx);
    const text = cleanText(body, LIMITS.messageLength, "Message");
    await rememberProfile(ctx); // a question can be someone's first contact: the other side sees their name
    let c: Doc<"conversations">;
    if (conversationId) c = await participant(ctx, conversationId, me);
    else {
      requireThat(toolId, "Choose a conversation.");
      const tool = await ctx.db.get(toolId);
      requireThat(tool && !tool.deleted, "That listing is no longer available.");
      requireThat(tool.owner !== me.subject, "This is your own listing.");
      const existing = await findConversation(ctx, toolId, me.subject);
      if (!existing) {
        // Abuse control: a new account can't message every lender on the board.
        const startedToday = await ctx.db
          .query("conversations")
          .withIndex("borrower", (q) => q.eq("borrower", me.subject).gt("_creationTime", Date.now() - 86_400_000))
          .take(NEW_CONVERSATIONS_PER_DAY);
        requireThat(
          startedToday.length < NEW_CONVERSATIONS_PER_DAY,
          "You've started a lot of conversations today. Try again tomorrow.",
        );
      }
      c = existing ?? (await openConversation(ctx, tool, me.subject));
    }
    const state = await openState(ctx, c, me.subject);
    requireThat(
      state.open,
      state.reason === "removed" ? "This listing was removed, so the conversation is closed." : "You can't message this neighbor.",
    );
    const lastMinute = await ctx.db
      .query("messages")
      .withIndex("conversation", (q) => q.eq("conversationId", c._id).gt("at", Date.now() - 60_000))
      .collect();
    requireThat(
      lastMinute.filter((m) => m.author === me.subject).length < LIMITS.messagesPerMinute,
      "You're sending messages too quickly. Wait a moment.",
    );
    const other = c.owner === me.subject ? c.borrower : c.owner;
    const { hadUnread } = await post(ctx, c, { author: me.subject, body: text }, other);
    // One notification per unread batch, never with the text.
    if (!hadUnread)
      await notify(ctx, { toolId: c.toolId, kind: "message", recipient: other, actor: me.subject, timeline: false });
    return c._id;
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await actor(ctx);
    const row = await inboxRow(ctx, conversationId, me.subject);
    if (row && row.unread > 0) await ctx.db.patch(row._id, { unread: 0 });
  },
});

// Block (or unblock) the other person: no messages and no requests between you, on any item.
export const setBlocked = mutation({
  args: { conversationId: v.id("conversations"), blocked: v.boolean() },
  handler: async (ctx, { conversationId, blocked }) => {
    const me = await actor(ctx);
    const c = await participant(ctx, conversationId, me);
    const other = c.owner === me.subject ? c.borrower : c.owner;
    const { iBlocked } = await blockBetween(ctx, me.subject, other);
    if (blocked && !iBlocked) await ctx.db.insert("blocks", { blocker: me.subject, blocked: other, at: Date.now() });
    if (!blocked && iBlocked) await ctx.db.delete(iBlocked._id);
  },
});

// Unread messages across all conversations, for the Messages tab badge.
export const unreadTotal = query({
  args: {},
  handler: async (ctx) => {
    const me = await actor(ctx);
    const rows = await ctx.db
      .query("inbox")
      .withIndex("unread", (q) => q.eq("subject", me.subject).gt("unread", 0))
      .take(100);
    return rows.reduce((n, r) => n + r.unread, 0);
  },
});
