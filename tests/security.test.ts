/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { signToken, sha256Hex } from "../lib/signing";

const modules = import.meta.glob("../convex/**/*.ts");
const TODAY = "2026-11-04";
const page = { numItems: 50, cursor: null };
const fields = { name: "Cordless drill", category: "Power tools", condition: "Good", description: "Private details" };
const SECRET = "s".repeat(48);

function setup() {
  const t = convexTest(schema, modules);
  const as = (subject: string, email = `${subject}@example.com`) =>
    t.withIdentity({ subject, name: subject.toUpperCase(), email });
  return { t, owner: as("owner"), borrower: as("borrower"), stranger: as("stranger"), admin: as("admin") };
}
type Setup = ReturnType<typeof setup>;

async function listAndRequest(s: Setup, start = "2026-11-05", end = "2026-11-07") {
  const tool = await s.owner.mutation(api.tools.saveTool, fields);
  const loan = await s.borrower.mutation(api.loans.requestLoan, { toolId: tool, start, end, today: TODAY });
  return { tool, loan };
}

async function message(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return e instanceof ConvexError ? e.data : `not a ConvexError: ${e}`;
  }
  return "did not throw";
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T10:00:00Z`));
  vi.stubEnv("ADMIN_SUBJECTS", "admin");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("public page and authentication", () => {
  test("shows only name and category of tools free today; anonymous writes fail", async () => {
    const s = setup();
    const { loan } = await listAndRequest(s);
    await s.owner.mutation(api.tools.saveTool, { ...fields, name: "Ladder" });
    const shown = await s.t.query(api.tools.publicTools, { today: TODAY, paginationOpts: page });
    expect(shown.page).toEqual([
      { name: "Ladder", category: "Power tools" },
      { name: "Cordless drill", category: "Power tools" },
    ]);
    await s.owner.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY });
    vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
    const later = await s.t.query(api.tools.publicTools, { today: "2026-11-05", paginationOpts: page });
    expect(later.page.map((t) => t.name)).toEqual(["Ladder"]);
    await expect(s.t.mutation(api.tools.saveTool, fields)).rejects.toThrow();
    await expect(s.t.query(api.tools.browse, { today: TODAY, paginationOpts: page })).rejects.toThrow();
  });

  test("a new listing stays visible past 500 old ones (regression)", async () => {
    const s = setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 600; i++)
        await ctx.db.insert("tools", { ...fields, owner: "old", deleted: i % 2 === 0 });
    });
    await s.owner.mutation(api.tools.saveTool, { ...fields, name: "Brand new tent" });
    const first = await s.borrower.query(api.tools.browse, { today: TODAY, paginationOpts: { numItems: 24, cursor: null } });
    expect(first.page[0].name).toBe("Brand new tent");
    expect(await s.t.query(api.tools.publicTools, { today: TODAY, paginationOpts: { numItems: 1, cursor: null } })).toMatchObject({
      page: [{ name: "Brand new tent" }],
    });
    expect((await s.owner.query(api.tools.myListings, { today: TODAY })).map((t) => t.name)).toEqual(["Brand new tent"]);
  });

  test("a client date more than a day from UTC is rejected", async () => {
    const s = setup();
    expect(await message(s.borrower.query(api.tools.browse, { today: "2026-11-07", paginationOpts: page }))).toMatch(/date looks wrong/);
  });
});

describe("authorization is enforced on the server", () => {
  test("strangers cannot touch other people's listings or loans", async () => {
    const s = setup();
    const { tool, loan } = await listAndRequest(s);
    const denied = [
      () => s.stranger.mutation(api.tools.saveTool, { ...fields, id: tool }),
      () => s.stranger.mutation(api.tools.removeTool, { id: tool }),
      () => s.stranger.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY }),
      () => s.stranger.mutation(api.loans.cancelRequest, { id: loan }),
      () => s.stranger.mutation(api.loans.reportReturn, { id: loan }),
      () => s.stranger.mutation(api.loans.confirmReturn, { id: loan }),
      () => s.stranger.mutation(api.tools.setTrusted, { toolId: tool, trusted: true }),
      () => s.stranger.query(api.loans.adminLoans, { paginationOpts: page }),
      () => s.stranger.query(api.notify.failures, {}),
      // The borrower may not answer their own request either.
      () => s.borrower.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY }),
    ];
    for (const attempt of denied) await expect(attempt()).rejects.toThrow(ConvexError);
    expect((await s.stranger.query(api.loans.myRequests, { paginationOpts: page })).page).toEqual([]);
    expect((await s.stranger.query(api.loans.incoming, { paginationOpts: page })).page).toEqual([]);
  });

  test("only the owner confirms a return; the borrower's report keeps the loan open (regression)", async () => {
    const s = setup();
    const { tool, loan } = await listAndRequest(s);
    await s.owner.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY });
    await expect(s.borrower.mutation(api.loans.confirmReturn, { id: loan })).rejects.toThrow(ConvexError);
    await s.borrower.mutation(api.loans.reportReturn, { id: loan });
    expect(await s.owner.query(api.loans.needsAnswer, {})).toMatchObject([{ _id: loan, returnReported: true }]);
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    const [view] = await s.borrower.query(api.tools.browse, { today: "2026-11-06", paginationOpts: page }).then((r) => r.page);
    expect(view).toMatchObject({ _id: tool, available: false });
    // Overdue: the reminder now asks the owner to confirm instead of chasing the borrower.
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const claim = await s.t.mutation(internal.automation.claimReminders, { limit: 10 });
    expect(claim.reminders).toMatchObject([{ kind: "confirm_return", recipient: { name: "OWNER" } }]);
    await s.owner.mutation(api.loans.confirmReturn, { id: loan });
    const [after] = await s.borrower.query(api.loans.myRequests, { paginationOpts: page }).then((r) => r.page);
    expect(after.status).toBe("returned");
  });

  test("an admin cannot vouch for themselves (regression); trust and removal are audited", async () => {
    const s = setup();
    const own = await s.admin.mutation(api.tools.saveTool, fields);
    expect(await message(s.admin.mutation(api.tools.setTrusted, { toolId: own, trusted: true }))).toMatch(/vouch/);
    const { tool } = await listAndRequest(s);
    await s.admin.mutation(api.tools.setTrusted, { toolId: tool, trusted: true });
    await s.admin.mutation(api.tools.removeTool, { id: tool });
    const rows = await s.t.run(async (ctx) => ({
      audit: await ctx.db.query("audit").collect(),
      events: await ctx.db.query("events").collect(),
      loans: await ctx.db.query("loans").collect(),
    }));
    expect(rows.audit.map((a) => [a.actor, a.action])).toEqual([
      ["admin", "lender.trusted"],
      ["admin", "listing.removed"],
    ]);
    expect(rows.events.map((e) => [e.kind, e.recipient])).toEqual([
      ["requested", "owner"],
      ["declined", "borrower"],
      ["listing_removed", "owner"],
    ]);
    expect(rows.loans[0].status).toBe("declined");
  });

  test("participants see each other's email only while the loan is approved; admins see names only", async () => {
    const s = setup();
    const { loan } = await listAndRequest(s);
    const [pending] = (await s.owner.query(api.loans.incoming, { paginationOpts: page })).page;
    expect(pending.counterpart).toEqual({ name: "BORROWER", email: undefined });
    await s.owner.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY });
    const [approved] = (await s.borrower.query(api.loans.myRequests, { paginationOpts: page })).page;
    expect(approved.counterpart).toEqual({ name: "OWNER", email: "owner@example.com" });
    const [asAdmin] = (await s.admin.query(api.loans.adminLoans, { paginationOpts: page })).page;
    expect(asAdmin).toMatchObject({ role: "admin", ownerName: "OWNER", borrowerName: "BORROWER" });
    expect(asAdmin.counterpart).toBeUndefined();
  });
});

describe("loan rules", () => {
  test("approving one request declines the overlapping ones (regression); cancel works", async () => {
    const s = setup();
    const { tool, loan } = await listAndRequest(s);
    const clash = await s.stranger.mutation(api.loans.requestLoan, { toolId: tool, start: "2026-11-07", end: "2026-11-09", today: TODAY });
    const later = await s.stranger.mutation(api.loans.requestLoan, { toolId: tool, start: "2026-11-20", end: "2026-11-21", today: TODAY });
    await s.owner.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY });
    const status = async (id: Id<"loans">) => (await s.t.run((ctx) => ctx.db.get(id)))!.status;
    expect(await status(clash)).toBe("declined");
    expect(await status(later)).toBe("pending");
    await s.stranger.mutation(api.loans.cancelRequest, { id: later });
    expect(await status(later)).toBe("cancelled");
    expect(await message(s.borrower.mutation(api.loans.requestLoan, { toolId: tool, start: "2026-11-06", end: "2026-11-08", today: TODAY }))).toBe(
      "Those dates are already booked.",
    );
  });

  test("stale requests expire instead of waiting forever (regression)", async () => {
    const s = setup();
    const { loan } = await listAndRequest(s);
    vi.setSystemTime(new Date("2026-11-08T10:00:00Z"));
    await s.t.mutation(internal.loans.expireStale, {});
    expect((await s.t.run((ctx) => ctx.db.get(loan)))!.status).toBe("pending");
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    await s.t.mutation(internal.loans.expireStale, {});
    expect((await s.t.run((ctx) => ctx.db.get(loan)))!.status).toBe("expired");
  });

  test("users get readable ConvexError messages (regression) and quotas apply", async () => {
    const s = setup();
    const tool = await s.owner.mutation(api.tools.saveTool, fields);
    const ask = (start: string, end: string) =>
      message(s.borrower.mutation(api.loans.requestLoan, { toolId: tool, start, end, today: TODAY }));
    expect(await ask("2026-11-01", "2026-11-02")).toMatch(/starts today or later/);
    expect(await ask("2026-11-05", "2027-03-01")).toMatch(/at most 90 days/);
    expect(await ask("2026-02-30", "2026-03-01")).toMatch(/valid date range/);
    expect(await message(s.owner.mutation(api.loans.requestLoan, { toolId: tool, start: "2026-11-05", end: "2026-11-06", today: TODAY }))).toMatch(/own tool/);
    expect(await message(s.owner.mutation(api.tools.saveTool, { ...fields, name: "   " }))).toMatch(/Tool name is required/);
    expect(await message(s.owner.mutation(api.tools.saveTool, { ...fields, category: "Weapons" }))).toMatch(/categories/);
    for (let i = 0; i < 10; i++) expect(await ask(`2026-12-${String(i * 2 + 1).padStart(2, "0")}`, `2026-12-${String(i * 2 + 1).padStart(2, "0")}`)).toBe("did not throw");
    expect(await ask("2027-01-10", "2027-01-11")).toMatch(/at most 10 open requests/);
  });

  test("an overdue tool shows as out; a future booking leaves it free until then", async () => {
    const s = setup();
    const { tool, loan } = await listAndRequest(s, "2026-11-10", "2026-11-12");
    await s.owner.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY });
    const view = async (today: string) => {
      vi.setSystemTime(new Date(`${today}T10:00:00Z`));
      return (await s.owner.query(api.tools.myListings, { today }))[0];
    };
    expect(await view(TODAY)).toMatchObject({ _id: tool, available: true, nextBooked: "2026-11-10" });
    expect(await view("2026-11-11")).toMatchObject({ available: false, overdue: false, until: "2026-11-12" });
    expect(await view("2026-11-15")).toMatchObject({ available: false, overdue: true });
  });
});

describe("reminder write-backs", () => {
  async function overdueLoan(s: Setup) {
    const { loan } = await listAndRequest(s, "2026-11-05", "2026-11-06");
    await s.owner.mutation(api.loans.decide, { id: loan, approve: true, today: TODAY });
    return loan;
  }

  test("claims are leased, reports are idempotent, a sent reminder is not claimed again", async () => {
    const s = setup();
    const loan = await overdueLoan(s);
    vi.setSystemTime(new Date("2026-11-08T09:00:00Z"));
    const first = await s.t.mutation(internal.automation.claimReminders, { limit: 10 });
    expect(first.reminders).toMatchObject([{ loanId: loan, kind: "overdue", daysOverdue: 2, idempotencyKey: `reminder:${loan}:2026-11-08` }]);
    // A retried or overlapping run gets nothing while the claim is leased.
    expect((await s.t.mutation(internal.automation.claimReminders, { limit: 10 })).reminders).toEqual([]);
    const report = { results: [{ loanId: loan, day: "2026-11-08", status: "sent" as const }] };
    expect(await s.t.mutation(internal.automation.reportReminders, report)).toEqual({ recorded: 1 });
    expect(await s.t.mutation(internal.automation.reportReminders, report)).toEqual({ recorded: 0 });
    vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
    expect((await s.t.mutation(internal.automation.claimReminders, { limit: 10 })).reminders).toEqual([]);
    const activity = await s.t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity.filter((a) => a.kind === "reminder_sent")).toHaveLength(1);
  });

  test("a failed reminder is retried on later runs, at most three times a day", async () => {
    const s = setup();
    const loan = await overdueLoan(s);
    vi.setSystemTime(new Date("2026-11-08T09:00:00Z"));
    for (let run = 0; run < 4; run++) {
      const { reminders } = await s.t.mutation(internal.automation.claimReminders, { limit: 10 });
      expect(reminders).toHaveLength(run < 3 ? 1 : 0);
      if (reminders.length)
        await s.t.mutation(internal.automation.reportReminders, {
          results: [{ loanId: loan, day: "2026-11-08", status: "failed", error: "provider down" }],
        });
    }
  });

  test("finds overdue loans behind more than 1000 older loans (regression)", async () => {
    const s = setup();
    const tool = await s.owner.mutation(api.tools.saveTool, fields);
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 1200; i++)
        await ctx.db.insert("loans", { toolId: tool, owner: "owner", borrower: "x", start: "2026-01-01", end: "2026-01-02", status: "returned" });
    });
    const loan = await overdueLoan(s);
    vi.setSystemTime(new Date("2026-11-08T09:00:00Z"));
    const { reminders } = await s.t.mutation(internal.automation.claimReminders, { limit: 10 });
    expect(reminders.map((r) => r.loanId)).toEqual([loan]);
  });
});

describe("signed automation HTTP", () => {
  async function signed(path: string, body: string, claims: Record<string, unknown> = {}) {
    const iat = Math.floor(Date.now() / 1000);
    const token = await signToken(SECRET, {
      iss: "lendloop-n8n",
      aud: "lendloop-convex",
      iat,
      exp: iat + 300,
      method: "POST",
      path,
      body_sha256: await sha256Hex(body),
      ...claims,
    });
    return { method: "POST", headers: { authorization: `Bearer ${token}` }, body };
  }

  test("accepts only a token bound to this route, body and time", async () => {
    vi.stubEnv("AUTOMATION_SECRET", SECRET);
    const s = setup();
    const path = "/automation/reminders/claim";
    const body = JSON.stringify({ limit: 5 });
    expect((await s.t.fetch(path, { method: "POST", body })).status).toBe(401);
    const ok = await s.t.fetch(path, await signed(path, body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ day: TODAY, reminders: [] });
    const tampered = await signed(path, body);
    expect((await s.t.fetch(path, { ...tampered, body: JSON.stringify({ limit: 200 }) })).status).toBe(401);
    expect((await s.t.fetch(path, await signed("/automation/failures", body, { path: "/automation/failures" }))).status).toBe(401);
    expect((await s.t.fetch(path, await signed(path, body, { iss: "someone-else" }))).status).toBe(401);
    expect((await s.t.fetch(path, await signed(path, body, { exp: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401);
    expect((await s.t.fetch(path, await signed(path, body, { exp: Math.floor(Date.now() / 1000) + 3600 }))).status).toBe(401);
    const otherKey = await signToken("o".repeat(48), {
      iss: "lendloop-n8n", aud: "lendloop-convex", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60,
      method: "POST", path, body_sha256: await sha256Hex(body),
    });
    expect((await s.t.fetch(path, { method: "POST", headers: { authorization: `Bearer ${otherKey}` }, body })).status).toBe(401);
    expect((await s.t.fetch(path, { method: "GET" })).status).toBeGreaterThanOrEqual(400);
  });

  test("failure reports are stored once per execution and shown to admins only", async () => {
    vi.stubEnv("AUTOMATION_SECRET", SECRET);
    const s = setup();
    const path = "/automation/failures";
    const body = JSON.stringify({ executionId: "42", workflow: "LendLoop - Overdue reminders", node: "Send report to Convex", message: "HTTP 500" });
    expect(await (await s.t.fetch(path, await signed(path, body))).json()).toEqual({ recorded: true });
    expect(await (await s.t.fetch(path, await signed(path, body))).json()).toEqual({ recorded: false });
    expect((await s.admin.query(api.notify.failures, {})).runs).toMatchObject([{ workflow: "LendLoop - Overdue reminders", message: "HTTP 500" }]);
  });
});

describe("notification outbox", () => {
  test("lease, stale answers, exhaustion, recovery and admin retry", async () => {
    const s = setup();
    const { loan } = await listAndRequest(s);
    const event = (await s.t.run((ctx) => ctx.db.query("events").first()))!;
    const get = () => s.t.run((ctx) => ctx.db.get(event._id));
    expect(await s.t.mutation(internal.notify.claim, { id: event._id })).toEqual({ attempts: 1 });
    expect(await s.t.mutation(internal.notify.claim, { id: event._id })).toBeNull();
    // An answer from an older attempt is ignored.
    await s.t.mutation(internal.notify.settle, { id: event._id, attempt: 0, ok: true });
    expect((await get())!.state).toBe("sending");
    await s.t.mutation(internal.notify.settle, { id: event._id, attempt: 1, ok: false, error: "HTTP 502" });
    expect(await get()).toMatchObject({ state: "pending", error: "HTTP 502" });
    // Exhausted: failed, on the loan timeline and on the admin page; an admin can retry it.
    await s.t.run((ctx) => ctx.db.patch(event._id, { attempts: 6, leaseUntil: 0 }));
    expect(await s.t.mutation(internal.notify.claim, { id: event._id })).toBeNull();
    expect((await get())!.state).toBe("failed");
    const kinds = (await s.t.run((ctx) => ctx.db.query("activity").collect())).map((a) => a.kind);
    expect(kinds).toContain("notification_failed");
    expect((await s.admin.query(api.notify.failures, {})).deliveries).toMatchObject([{ kind: "requested", attempts: 6 }]);
    await expect(s.owner.mutation(api.notify.retry, { id: event._id })).rejects.toThrow(ConvexError);
    await s.admin.mutation(api.notify.retry, { id: event._id });
    expect(await get()).toMatchObject({ state: "pending", attempts: 0 });
    expect(loan).toBeTruthy();
  });

  test("the webhook message carries only what the notification needs", async () => {
    const s = setup();
    await s.owner.mutation(api.users.syncProfile, {});
    await listAndRequest(s);
    const event = (await s.t.run((ctx) => ctx.db.query("events").first()))!;
    const msg = await s.t.query(internal.notify.message, { id: event._id });
    expect(msg).toEqual({
      eventId: event._id,
      kind: "requested",
      recipient: { name: "OWNER", email: "owner@example.com" },
      tool: { name: "Cordless drill" },
      loan: { start: "2026-11-05", end: "2026-11-07" },
    });
    expect(JSON.stringify(msg)).not.toMatch(/borrower|Private details/);
  });
});
