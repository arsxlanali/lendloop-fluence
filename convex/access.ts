import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
export async function actor(ctx: QueryCtx | MutationCtx) {
  const user = await ctx.auth.getUserIdentity();
  if (!user) throw new ConvexError("Sign in required");
  // Admin subjects come from a deployment secret. Client-submitted roles are never trusted.
  const admin = (process.env.ADMIN_SUBJECTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(user.subject);
  return { subject: user.subject, admin };
}
export function requireThat(
  value: unknown,
  message = "Not permitted",
): asserts value {
  if (!value) throw new ConvexError(message);
}
