import { mutation, query, type QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { actor, requireAdmin, requireThat, type Actor } from "./access";
import { audit, availability, isTrusted, notify, rememberProfile } from "./model";
import { categories, checkClientToday, cleanText, LIMITS } from "../lib/policy";

function checkCategory(category: string) {
  if (!(categories as readonly string[]).includes(category))
    throw new ConvexError("Choose one of the listed categories.");
  return category;
}

// Signed-out visitors: names and categories of tools that are free today, nothing else (no
// IDs, owners, descriptions or dates). Pages are filled here rather than with paginate(), which
// would return pages of on-loan tools as empty pages. `next` is the creation time to continue
// from; null when there is nothing older.
const PUBLIC_PAGE = 24;
const PUBLIC_SCAN = 200;

export const publicTools = query({
  args: { today: v.string(), before: v.optional(v.number()) },
  handler: async (ctx, { today, before }) => {
    checkClientToday(today);
    const tools: { name: string; category: string }[] = [];
    let scanned = 0;
    let last: number | null = null;
    const newestFirst = ctx.db
      .query("tools")
      .withIndex("active", (q) =>
        before === undefined ? q.eq("deleted", false) : q.eq("deleted", false).lt("_creationTime", before),
      )
      .order("desc");
    for await (const t of newestFirst) {
      if (tools.length >= PUBLIC_PAGE || scanned >= PUBLIC_SCAN) return { tools, next: last };
      scanned++;
      last = t._creationTime;
      if ((await availability(ctx, t._id, today)).available)
        tools.push({ name: t.name, category: t.category });
    }
    return { tools, next: null };
  },
});

async function toolView(
  ctx: QueryCtx,
  t: Doc<"tools">,
  me: Actor,
  today: string,
  trustedCache: Map<string, boolean>,
) {
  if (!trustedCache.has(t.owner)) trustedCache.set(t.owner, await isTrusted(ctx, t.owner));
  return {
    _id: t._id,
    name: t.name,
    category: t.category,
    condition: t.condition,
    description: t.description,
    mine: t.owner === me.subject,
    trusted: trustedCache.get(t.owner)!,
    ...(await availability(ctx, t._id, today)),
  };
}

export const browse = query({
  args: {
    category: v.optional(v.string()),
    search: v.optional(v.string()),
    today: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { category, search, today, paginationOpts }) => {
    const me = await actor(ctx);
    checkClientToday(today);
    const cat = category ? checkCategory(category) : undefined;
    const term = search?.trim().slice(0, 60);
    // A search is ranked by relevance; otherwise newest first.
    const tools = term
      ? ctx.db.query("tools").withSearchIndex("search", (q) => {
          const s = q.search("name", term).eq("deleted", false);
          return cat ? s.eq("category", cat) : s;
        })
      : (cat
          ? ctx.db.query("tools").withIndex("category", (q) => q.eq("deleted", false).eq("category", cat))
          : ctx.db.query("tools").withIndex("active", (q) => q.eq("deleted", false))
        ).order("desc");
    const result = await tools.paginate(paginationOpts);
    // Tools I already asked for, so the card can say so instead of offering another request.
    const mine = await ctx.db
      .query("loans")
      .withIndex("borrowerStatus", (q) => q.eq("borrower", me.subject).eq("status", "pending"))
      .take(LIMITS.pendingRequestsPerBorrower);
    const requested = new Set(mine.map((l) => l.toolId));
    const cache = new Map<string, boolean>();
    const page = [];
    for (const t of result.page)
      page.push({ ...(await toolView(ctx, t, me, today, cache)), requested: requested.has(t._id) });
    return { ...result, page };
  },
});

// Dates already taken, shown when choosing dates. Ranges only: nothing about who borrows.
export const bookings = query({
  args: { toolId: v.id("tools"), today: v.string() },
  handler: async (ctx, { toolId, today }) => {
    await actor(ctx);
    checkClientToday(today);
    const loans = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", toolId).eq("status", "approved").gte("end", today))
      .take(10);
    return loans.map((l) => ({ start: l.start, end: l.end }));
  },
});

export const myListings = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const me = await actor(ctx);
    checkClientToday(today);
    const tools = await ctx.db
      .query("tools")
      .withIndex("owner", (q) => q.eq("owner", me.subject).eq("deleted", false))
      .order("desc")
      .take(LIMITS.activeListingsPerUser);
    const cache = new Map<string, boolean>();
    return await Promise.all(
      tools.map(async (t) => ({
        ...(await toolView(ctx, t, me, today, cache)),
        pendingRequests: (
          await ctx.db
            .query("loans")
            .withIndex("tool", (q) => q.eq("toolId", t._id).eq("status", "pending"))
            .take(50)
        ).length,
      })),
    );
  },
});

export const saveTool = mutation({
  args: {
    id: v.optional(v.id("tools")),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
  },
  handler: async (ctx, a) => {
    const me = await actor(ctx);
    await rememberProfile(ctx);
    const fields = {
      name: cleanText(a.name, LIMITS.nameLength, "Tool name"),
      category: checkCategory(a.category),
      condition: cleanText(a.condition, LIMITS.conditionLength, "Condition"),
      description: cleanText(a.description, LIMITS.descriptionLength, "Description", false),
    };
    if (a.id) {
      const old = await ctx.db.get(a.id);
      requireThat(old && !old.deleted && old.owner === me.subject, "You can only edit your own listings.");
      await ctx.db.patch(a.id, fields);
      return a.id;
    }
    const active = await ctx.db
      .query("tools")
      .withIndex("owner", (q) => q.eq("owner", me.subject).eq("deleted", false))
      .take(LIMITS.activeListingsPerUser);
    requireThat(
      active.length < LIMITS.activeListingsPerUser,
      `You can have at most ${LIMITS.activeListingsPerUser} active listings.`,
    );
    return await ctx.db.insert("tools", { ...fields, owner: me.subject, deleted: false });
  },
});

// Soft removal: the listing disappears, open requests are declined and their borrowers told,
// approved loans and every timeline stay intact. An admin removal is audited and the owner told.
export const removeTool = mutation({
  args: { id: v.id("tools") },
  handler: async (ctx, { id }) => {
    const me = await actor(ctx);
    const t = await ctx.db.get(id);
    requireThat(t && !t.deleted, "That listing no longer exists.");
    const asOwner = t.owner === me.subject;
    requireThat(asOwner || me.admin, "You can only remove your own listings.");
    await ctx.db.patch(id, { deleted: true, deletedAt: Date.now(), deletedBy: me.subject });
    const pending = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", id).eq("status", "pending"))
      .collect();
    for (const l of pending) {
      await ctx.db.patch(l._id, { status: "declined" });
      await notify(ctx, { loanId: l._id, kind: "declined", recipient: l.borrower, actor: me.subject });
    }
    if (!asOwner) {
      await audit(ctx, me.subject, "listing.removed", id);
      await notify(ctx, { toolId: id, kind: "listing_removed", recipient: t.owner, actor: me.subject });
    }
  },
});

export const setTrusted = mutation({
  args: { toolId: v.id("tools"), trusted: v.boolean() },
  handler: async (ctx, { toolId, trusted }) => {
    const me = await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    requireThat(tool, "That listing no longer exists.");
    requireThat(tool.owner !== me.subject, "Admins can't vouch for themselves.");
    const old = await ctx.db
      .query("trusted")
      .withIndex("subject", (q) => q.eq("subject", tool.owner))
      .unique();
    if (trusted && !old) {
      await ctx.db.insert("trusted", { subject: tool.owner, by: me.subject, at: Date.now() });
      await audit(ctx, me.subject, "lender.trusted", tool.owner);
    }
    if (!trusted && old) {
      await ctx.db.delete(old._id);
      await audit(ctx, me.subject, "lender.untrusted", tool.owner);
    }
  },
});
