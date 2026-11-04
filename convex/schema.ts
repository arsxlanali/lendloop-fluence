import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const loanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("returned"),
);

export default defineSchema({
  // Name shown to the other party of a loan; email used only to send notifications, never
  // shown to other users. Copied from the verified Clerk token, never from client arguments.
  users: defineTable({
    subject: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
  }).index("subject", ["subject"]),

  tools: defineTable({
    owner: v.string(),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
    deleted: v.boolean(),
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.string()),
  })
    .index("active", ["deleted"])
    .index("category", ["deleted", "category"])
    .index("owner", ["owner", "deleted"])
    .searchIndex("search", { searchField: "name", filterFields: ["deleted", "category"] }),

  loans: defineTable({
    toolId: v.id("tools"),
    owner: v.string(),
    borrower: v.string(),
    start: v.string(),
    end: v.string(),
    status: loanStatus,
    // Optional messages between the two neighbors, written by them and shown only to them:
    // contact details are shared only if a user chooses to write them here.
    requestNote: v.optional(v.string()),
    handoverNote: v.optional(v.string()),
    // The borrower says the tool is back; the owner confirms (or says it isn't). Until then
    // the loan stays open and the tool unavailable.
    returnReportedAt: v.optional(v.number()),
    lastReminder: v.optional(v.string()),
  })
    .index("tool", ["toolId", "status", "end"])
    .index("owner", ["owner"])
    .index("ownerStatus", ["owner", "status"])
    .index("borrower", ["borrower"])
    .index("borrowerStatus", ["borrower", "status"])
    .index("statusEnd", ["status", "end"]),

  trusted: defineTable({
    subject: v.string(),
    by: v.string(),
    at: v.number(),
  }).index("subject", ["subject"]),

  // Timeline shown on each loan: what people did and what the automations did.
  activity: defineTable({
    loanId: v.id("loans"),
    kind: v.string(),
    at: v.number(),
    actor: v.string(), // a Clerk subject, "automation" or "system"
  }).index("loan", ["loanId", "at"]),

  // Admin actions, kept apart from loan timelines.
  audit: defineTable({
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    at: v.number(),
  }),

  // Outbox for Convex -> n8n notifications, written in the same transaction as the change.
  events: defineTable({
    loanId: v.optional(v.id("loans")),
    toolId: v.optional(v.id("tools")),
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
  }).index("state", ["state", "leaseUntil"]),

  // One row per loan and day: the reminder workflow claims it before sending, then reports
  // sent or failed. A claim that is never reported can be taken again after its lease.
  reminders: defineTable({
    loanId: v.id("loans"),
    day: v.string(),
    state: v.union(v.literal("claimed"), v.literal("sent"), v.literal("failed")),
    leaseUntil: v.number(),
    attempts: v.number(),
    error: v.optional(v.string()),
  })
    .index("loanDay", ["loanId", "day"])
    .index("dayState", ["day", "state"]),

  // Failed n8n executions reported by the error workflow, shown to admins in the app.
  automationFailures: defineTable({
    executionId: v.string(),
    workflow: v.string(),
    node: v.string(),
    message: v.string(),
    at: v.number(),
  }).index("execution", ["executionId"]),
});
