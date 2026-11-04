import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { categories } from "../lib/policy";

// Sample listings for a fresh deployment, so the board isn't empty on first visit:
//   npx convex run --prod seed:demo '{"owner": "user_...", "name": "Sam"}'
// Internal, so no browser can call it. Does nothing if the owner already lists tools.
const SAMPLE: { name: string; category: (typeof categories)[number]; condition: string; description: string }[] = [
  { name: "Cordless drill", category: "Power tools", condition: "Good, two batteries", description: "18 V drill driver with a bit set and charger." },
  { name: "Circular saw", category: "Power tools", condition: "Good, blade replaced in May", description: "7¼\" saw with a spare blade and a rip fence. Safety glasses included." },
  { name: "Step ladder (6 ft)", category: "Other", condition: "Sturdy", description: "Aluminium, rated to 120 kg." },
  { name: "Lawn mower", category: "Garden", condition: "Like new", description: "Battery mower with two charged batteries. Cuts a small lawn on one charge." },
  { name: "Hedge trimmer", category: "Garden", condition: "Good", description: "Corded, 20\" blade. Extension lead not included." },
  { name: "Stand mixer", category: "Kitchen", condition: "Gently used", description: "5 qt bowl, whisk, paddle and dough hook." },
  { name: "Pasta maker", category: "Kitchen", condition: "Like new", description: "Hand-crank roller with fettuccine and spaghetti cutters." },
  { name: "4-person tent", category: "Camping", condition: "Good, one small patch", description: "Freestanding dome tent with footprint and stakes. Packs to 60 cm." },
  { name: "Camping stove", category: "Camping", condition: "Good", description: "Two-burner propane stove. Gas canister not included." },
];

export const demo = internalMutation({
  args: { owner: v.string(), name: v.string() },
  handler: async (ctx, { owner, name }) => {
    const listed = await ctx.db
      .query("tools")
      .withIndex("owner", (q) => q.eq("owner", owner).eq("deleted", false))
      .first();
    if (listed) return 0;
    const user = await ctx.db
      .query("users")
      .withIndex("subject", (q) => q.eq("subject", owner))
      .unique();
    if (!user) await ctx.db.insert("users", { subject: owner, name });
    for (const tool of SAMPLE) await ctx.db.insert("tools", { ...tool, owner, deleted: false });
    return SAMPLE.length;
  },
});
