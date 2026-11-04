import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { actor, requireThat, type Actor } from "./access";
import { FALLBACK_NAME, notify, profile, readAt, unreadFor } from "./model";
import { cleanText, LIMITS } from "../lib/policy";

const OPEN = new Set(["pending", "approved"]);
const SHOWN = 100;

// Only the two people on a loan, never admins: the conversation is theirs.
export function side(loan: Doc<"loans"> | null, me: Actor) {
  if (loan?.owner === me.subject) return "owner" as const;
  if (loan?.borrower === me.subject) return "borrower" as const;
  return null;
}

export const list = query({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await actor(ctx);
    const loan = await ctx.db.get(loanId);
    const as = side(loan, me);
    requireThat(loan && as, "Only the two people on this loan can see its messages.");
    const otherSubject = as === "owner" ? loan.borrower : loan.owner;
    const otherName = (await profile(ctx, otherSubject))?.name ?? FALLBACK_NAME;
    const newest = await ctx.db
      .query("messages")
      .withIndex("loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .take(SHOWN);
    const messages = newest.reverse().map((m) => ({
      _id: m._id as string,
      body: m.body,
      at: m.at,
      mine: m.author === me.subject,
    }));
    // The request note opens the conversation.
    if (loan.requestNote && newest.length < SHOWN)
      messages.unshift({ _id: "request", body: loan.requestNote, at: loan._creationTime, mine: as === "borrower" });
    const read = readAt(loan, as);
    return {
      open: OPEN.has(loan.status),
      otherName,
      messages,
      unread: newest.some((m) => m.author !== me.subject && m.at > read),
    };
  },
});

export const send = mutation({
  args: { loanId: v.id("loans"), body: v.string() },
  handler: async (ctx, { loanId, body }) => {
    const me = await actor(ctx);
    const loan = await ctx.db.get(loanId);
    const as = side(loan, me);
    requireThat(loan && as, "Only the two people on this loan can send messages.");
    requireThat(OPEN.has(loan.status), "This conversation is closed because the loan is finished.");
    const text = cleanText(body, LIMITS.messageLength, "Message");
    const now = Date.now();
    const lastMinute = await ctx.db
      .query("messages")
      .withIndex("loan", (q) => q.eq("loanId", loanId).gt("at", now - 60_000))
      .collect();
    requireThat(
      lastMinute.filter((m) => m.author === me.subject).length < LIMITS.messagesPerMinute,
      "You're sending messages too quickly. Wait a moment.",
    );
    // Tell the other side once per unread batch: skip if they already have one of mine unread.
    const otherAs = as === "owner" ? "borrower" : "owner";
    const theyRead = readAt(loan, otherAs);
    const alreadyUnread = await ctx.db
      .query("messages")
      .withIndex("loan", (q) => q.eq("loanId", loanId).gt("at", theyRead))
      .filter((q) => q.eq(q.field("author"), me.subject))
      .first();
    await ctx.db.insert("messages", { loanId, author: me.subject, body: text, at: now });
    await ctx.db.patch(loanId, as === "owner" ? { ownerReadAt: now } : { borrowerReadAt: now });
    if (!alreadyUnread)
      await notify(ctx, {
        loanId,
        kind: "message",
        recipient: as === "owner" ? loan.borrower : loan.owner,
        actor: me.subject,
        timeline: false,
      });
  },
});

export const markRead = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await actor(ctx);
    const loan = await ctx.db.get(loanId);
    const as = side(loan, me);
    if (!loan || !as) return;
    await ctx.db.patch(loanId, as === "owner" ? { ownerReadAt: Date.now() } : { borrowerReadAt: Date.now() });
  },
});

// Unread messages across open loans, for the tab badges. Open loans per person are bounded
// (open requests, active bookings), so this stays small.
export const unreadCounts = query({
  args: {},
  handler: async (ctx) => {
    const me = await actor(ctx);
    const count = async (as: "owner" | "borrower") => {
      let total = 0;
      for (const status of ["pending", "approved"] as const) {
        const loans = await (as === "owner"
          ? ctx.db.query("loans").withIndex("ownerStatus", (q) => q.eq("owner", me.subject).eq("status", status))
          : ctx.db.query("loans").withIndex("borrowerStatus", (q) => q.eq("borrower", me.subject).eq("status", status))
        ).take(50);
        for (const loan of loans) total += await unreadFor(ctx, loan, me);
      }
      return total;
    };
    return { incoming: await count("owner"), requests: await count("borrower") };
  },
});
