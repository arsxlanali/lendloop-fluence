import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";

export type Actor = { subject: string; admin: boolean };

export async function actor(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const user = await ctx.auth.getUserIdentity();
  if (!user) throw new ConvexError("Sign in to continue.");
  return { subject: user.subject, admin: isAdmin(user.subject) };
}

// Admins are Clerk user IDs listed in a Convex deployment variable. Nothing the browser sends
// can make someone an admin, and removing an ID takes effect on the next call.
export function isAdmin(subject: string) {
  return (process.env.ADMIN_SUBJECTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(subject);
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const me = await actor(ctx);
  if (!me.admin) throw new ConvexError("Only admins can do that.");
  return me;
}

export function requireThat(value: unknown, message = "You can't do that."): asserts value {
  if (!value) throw new ConvexError(message);
}
