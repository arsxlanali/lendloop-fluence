import { mutation, query } from "./_generated/server";
import { actor } from "./access";
import { rememberProfile } from "./model";

// Called by the app after sign-in so a changed Clerk name or email reaches other participants.
export const syncProfile = mutation({
  args: {},
  handler: async (ctx) => {
    await rememberProfile(ctx);
    return null;
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const me = await actor(ctx);
    return { admin: me.admin };
  },
});
