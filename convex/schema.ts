import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  tools: defineTable({
    owner: v.string(),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
    deleted: v.boolean(),
  }).index("owner", ["owner"]),
  loans: defineTable({
    toolId: v.id("tools"),
    owner: v.string(),
    borrower: v.string(),
    start: v.string(),
    end: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("returned"),
    ),
    lastReminder: v.optional(v.string()),
  })
    .index("tool", ["toolId"])
    .index("owner", ["owner"])
    .index("borrower", ["borrower"]),
  trusted: defineTable({ subject: v.string() }).index("subject", ["subject"]),
  activity: defineTable({
    loanId: v.id("loans"),
    kind: v.string(),
    at: v.number(),
    key: v.string(),
  })
    .index("loan", ["loanId"])
    .index("key", ["key"]),
  events: defineTable({
    loanId: v.id("loans"),
    kind: v.string(),
    recipient: v.string(),
    attempts: v.number(),
    state: v.union(
      v.literal("pending"),
      v.literal("sending"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    leaseUntil: v.number(),
    error: v.optional(v.string()),
  }).index("state", ["state"]),
});
