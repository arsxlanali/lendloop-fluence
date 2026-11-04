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

  // One conversation per item and neighbor: everything between a tool's owner and one borrower
  // (questions, requests, status changes) in one place. Only the two of them can read it; message
  // text never leaves Convex (notifications only say that there is a new message).
  conversations: defineTable({
    toolId: v.id("tools"),
    owner: v.string(),
    borrower: v.string(),
    lastMessageAt: v.number(),
  })
    .index("pair", ["toolId", "borrower"])
    .index("borrower", ["borrower"]),

  // Each participant's view of a conversation: what the Messages tab lists, newest first.
  inbox: defineTable({
    subject: v.string(),
    conversationId: v.id("conversations"),
    role: v.union(v.literal("owner"), v.literal("borrower")),
    lastMessageAt: v.number(),
    unread: v.number(),
  })
    .index("recent", ["subject", "lastMessageAt"])
    .index("roleRecent", ["subject", "role", "lastMessageAt"])
    .index("unread", ["subject", "unread"])
    .index("conversation", ["conversationId", "subject"]),

  // Text from a participant, or a line about a loan change (event set; author is who did it,
  // or "system").
  messages: defineTable({
    conversationId: v.id("conversations"),
    author: v.string(),
    body: v.string(),
    at: v.number(),
    event: v.optional(v.string()),
    eventLoanId: v.optional(v.id("loans")),
  }).index("conversation", ["conversationId", "at"]),

  // A person who blocked another: no messages and no requests between them, on any item.
  blocks: defineTable({
    blocker: v.string(),
    blocked: v.string(),
    at: v.number(),
  }).index("pair", ["blocker", "blocked"]),

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
    // Set when an admin dismisses it (cause handled); kept for the record.
    resolvedAt: v.optional(v.number()),
  })
    .index("execution", ["executionId"])
    .index("open", ["resolvedAt"]),
});
