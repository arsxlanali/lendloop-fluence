import { query, mutation, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { actor, requireThat } from "./access";
import { internal } from "./_generated/api";
import { categories, overlaps, validateDates } from "../lib/policy";
import type { Id, Doc } from "./_generated/dataModel";
async function event(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  kind: string,
  recipient: string,
) {
  const id = await ctx.db.insert("events", {
    loanId: loan._id,
    kind,
    recipient,
    attempts: 0,
    state: "pending",
    leaseUntil: 0,
  });
  await ctx.db.insert("activity", {
    loanId: loan._id,
    kind,
    at: Date.now(),
    key: String(id),
  });
  await ctx.scheduler.runAfter(0, internal.delivery.send, { id });
}
export const publicTools = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").take(500);
    const result = [];
    for (const t of tools) {
      if (t.deleted) continue;
      const active = await ctx.db
        .query("loans")
        .withIndex("tool", (q) => q.eq("toolId", t._id))
        .collect();
      if (
        !active.some(
          (l) =>
            l.status === "approved" &&
            l.end >= new Date().toISOString().slice(0, 10),
        )
      )
        result.push({ name: t.name, category: t.category });
    }
    return result; // Explicit projection: no document IDs, owner identities or descriptions.
  },
});
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const me = await actor(ctx);
    const all = await ctx.db.query("tools").take(500);
    const today = new Date().toISOString().slice(0, 10);
    const tools = await Promise.all(
      all
        .filter((t) => !t.deleted)
        .map(async (t) => {
          const loans = await ctx.db
            .query("loans")
            .withIndex("tool", (q) => q.eq("toolId", t._id))
            .collect();
          const trusted = await ctx.db
            .query("trusted")
            .withIndex("subject", (q) => q.eq("subject", t.owner))
            .unique();
          return {
            _id: t._id,
            name: t.name,
            category: t.category,
            condition: t.condition,
            description: t.description,
            mine: t.owner === me.subject,
            trusted: !!trusted,
            available: !loans.some(
              (l) => l.status === "approved" && l.end >= today,
            ),
          };
        }),
    );
    const loans = me.admin
      ? await ctx.db.query("loans").take(500)
      : [
          ...(await ctx.db
            .query("loans")
            .withIndex("owner", (q) => q.eq("owner", me.subject))
            .collect()),
          ...(await ctx.db
            .query("loans")
            .withIndex("borrower", (q) => q.eq("borrower", me.subject))
            .collect()),
        ];
    return {
      admin: me.admin,
      tools,
      loans: await Promise.all(
        loans.map(async (l) => ({
          _id: l._id,
          toolId: l.toolId,
          name: (await ctx.db.get(l.toolId))?.name ?? "Removed listing",
          start: l.start,
          end: l.end,
          status: l.status,
          incoming: l.owner === me.subject,
          mine: l.borrower === me.subject,
          lastReminder: l.lastReminder,
          activity: (
            await ctx.db
              .query("activity")
              .withIndex("loan", (q) => q.eq("loanId", l._id))
              .collect()
          )
            .sort((a, b) => b.at - a.at)
            .slice(0, 5)
            .map((a) => ({ kind: a.kind, at: a.at })),
        })),
      ),
    };
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
    requireThat(
      a.name.trim().length > 0 &&
        a.name.length <= 100 &&
        a.condition.trim().length > 0 &&
        a.condition.length <= 100 &&
        a.description.length <= 1000 &&
        categories.includes(a.category),
      "Check listing fields",
    );
    const fields = {
      name: a.name.trim(),
      category: a.category,
      condition: a.condition.trim(),
      description: a.description.trim(),
    };
    if (a.id) {
      const old = await ctx.db.get(a.id);
      requireThat(old && !old.deleted && old.owner === me.subject);
      await ctx.db.patch(a.id, fields);
      return a.id;
    }
    return await ctx.db.insert("tools", {
      ...fields,
      owner: me.subject,
      deleted: false,
    });
  },
});
export const removeTool = mutation({
  args: { id: v.id("tools") },
  handler: async (ctx, { id }) => {
    const me = await actor(ctx);
    const t = await ctx.db.get(id);
    requireThat(t && (me.admin || t.owner === me.subject));
    const loans = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", id))
      .collect();
    // Preserve an active loan's audit trail. Retire the listing and decline outstanding requests.
    await ctx.db.patch(id, { deleted: true });
    for (const l of loans)
      if (l.status === "pending") {
        await ctx.db.patch(l._id, { status: "declined" });
        await event(ctx, l, "declined", l.borrower);
      }
  },
});
export const requestLoan = mutation({
  args: { toolId: v.id("tools"), start: v.string(), end: v.string() },
  handler: async (ctx, a) => {
    const me = await actor(ctx);
    validateDates(a.start, a.end);
    const t = await ctx.db.get(a.toolId);
    requireThat(t && !t.deleted && t.owner !== me.subject, "Tool unavailable");
    const loans = await ctx.db
      .query("loans")
      .withIndex("tool", (q) => q.eq("toolId", a.toolId))
      .collect();
    requireThat(
      !loans.some(
        (l) =>
          (l.status === "approved" ||
            (l.status === "pending" && l.borrower === me.subject)) &&
          overlaps(a.start, a.end, l.start, l.end),
      ),
      "Dates overlap an existing loan/request",
    );
    const id = await ctx.db.insert("loans", {
      ...a,
      owner: t.owner,
      borrower: me.subject,
      status: "pending",
    });
    await event(ctx, (await ctx.db.get(id))!, "requested", t.owner);
    return id;
  },
});
export const decide = mutation({
  args: { id: v.id("loans"), approve: v.boolean() },
  handler: async (ctx, { id, approve }) => {
    const me = await actor(ctx);
    const l = await ctx.db.get(id);
    requireThat(l && l.owner === me.subject);
    requireThat(l.status === "pending", "Already decided");
    if (approve) {
      const t = await ctx.db.get(l.toolId);
      requireThat(t && !t.deleted, "Listing removed");
      requireThat(
        l.end >= new Date().toISOString().slice(0, 10),
        "Request expired",
      );
      const loans = await ctx.db
        .query("loans")
        .withIndex("tool", (q) => q.eq("toolId", l.toolId))
        .collect();
      requireThat(
        !loans.some(
          (x) =>
            x.status === "approved" && overlaps(l.start, l.end, x.start, x.end),
        ),
        "Another loan overlaps",
      );
    }
    const status = approve ? "approved" : "declined";
    await ctx.db.patch(id, { status });
    await event(ctx, l, status, l.borrower);
  },
});
export const returned = mutation({
  args: { id: v.id("loans") },
  handler: async (ctx, { id }) => {
    const me = await actor(ctx);
    const l = await ctx.db.get(id);
    requireThat(l && (l.owner === me.subject || l.borrower === me.subject));
    requireThat(l.status === "approved", "Loan is not active");
    await ctx.db.patch(id, { status: "returned" });
    await event(
      ctx,
      l,
      "returned",
      l.owner === me.subject ? l.borrower : l.owner,
    );
  },
});
export const trustOwner = mutation({
  args: { toolId: v.id("tools"), trusted: v.boolean() },
  handler: async (ctx, { toolId, trusted }) => {
    const me = await actor(ctx);
    requireThat(me.admin);
    const tool = await ctx.db.get(toolId);
    requireThat(tool);
    const old = await ctx.db
      .query("trusted")
      .withIndex("subject", (q) => q.eq("subject", tool.owner))
      .unique();
    if (trusted && !old)
      await ctx.db.insert("trusted", { subject: tool.owner });
    if (!trusted && old) await ctx.db.delete(old._id);
  },
});
