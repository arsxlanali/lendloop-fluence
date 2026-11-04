/// <reference types="vite/client" />
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { signRequest, verifyRequest, signEnvelope } from "../lib/signing";
import { validateDates } from "../lib/policy";
const modules = import.meta.glob("../convex/**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  return {
    t,
    owner: t.withIdentity({ subject: "owner" }),
    borrower: t.withIdentity({ subject: "borrower" }),
    stranger: t.withIdentity({ subject: "stranger" }),
  };
};
const fields = {
  name: "Cordless drill",
  category: "Power tools",
  condition: "Good",
  description: "Private detailed description",
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
test("public output contains only name and category; anonymous writes fail", async () => {
  const { t, owner } = setup();
  await owner.mutation(api.board.saveTool, fields);
  expect(await t.query(api.board.publicTools, {})).toEqual([
    { name: fields.name, category: fields.category },
  ]);
  await expect(t.mutation(api.board.saveTool, fields)).rejects.toThrow();
});
test("strangers cannot edit/remove tools, decide loans, mark returns or grant trust", async () => {
  const { owner, borrower, stranger } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  const loan = await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-07",
  });
  await expect(
    stranger.mutation(api.board.saveTool, { ...fields, id }),
  ).rejects.toThrow();
  await expect(
    stranger.mutation(api.board.removeTool, { id }),
  ).rejects.toThrow();
  await expect(
    stranger.mutation(api.board.decide, { id: loan, approve: true }),
  ).rejects.toThrow();
  await expect(
    stranger.mutation(api.board.returned, { id: loan }),
  ).rejects.toThrow();
  await expect(
    stranger.mutation(api.board.trustOwner, { toolId: id, trusted: true }),
  ).rejects.toThrow();
});
test("overlapping pending requests cannot both be approved", async () => {
  const { owner, borrower, stranger } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  const a = await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-07",
  });
  const b = await stranger.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-07",
    end: "2026-11-09",
  });
  await owner.mutation(api.board.decide, { id: a, approve: true });
  await expect(
    owner.mutation(api.board.decide, { id: b, approve: true }),
  ).rejects.toThrow();
  await expect(
    borrower.mutation(api.board.requestLoan, {
      toolId: id,
      start: "2026-11-06",
      end: "2026-11-08",
    }),
  ).rejects.toThrow();
});
test("a request is private to participants; return reopens the listing", async () => {
  const { t, owner, borrower, stranger } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  const loan = await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-07",
  });
  expect((await stranger.query(api.board.dashboard, {})).loans).toEqual([]);
  await owner.mutation(api.board.decide, { id: loan, approve: true });
  expect(await t.query(api.board.publicTools, {})).toEqual([]);
  await borrower.mutation(api.board.returned, { id: loan });
  expect(await t.query(api.board.publicTools, {})).toHaveLength(1);
});
test("admin can remove any listing, trust lenders and view loans", async () => {
  vi.stubEnv("ADMIN_SUBJECTS", "administrator");
  const { t, owner, borrower } = setup();
  const admin = t.withIdentity({ subject: "administrator" });
  const id = await owner.mutation(api.board.saveTool, fields);
  await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-07",
  });
  await admin.mutation(api.board.trustOwner, { toolId: id, trusted: true });
  expect((await admin.query(api.board.dashboard, {})).loans).toHaveLength(1);
  await admin.mutation(api.board.removeTool, { id });
  expect(await t.query(api.board.publicTools, {})).toEqual([]);
});
test("invalid dates, own borrowing and duplicate pending requests are rejected", async () => {
  const { owner, borrower } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  await expect(
    owner.mutation(api.board.requestLoan, {
      toolId: id,
      start: "2026-11-05",
      end: "2026-11-06",
    }),
  ).rejects.toThrow();
  expect(() => validateDates("2026-02-30", "2026-03-01")).toThrow();
  expect(() => validateDates("2026-11-07", "2026-11-06")).toThrow();
  expect(() => validateDates("2026-11-01", "2026-11-06")).toThrow();
  const args = { toolId: id, start: "2026-11-05", end: "2026-11-06" };
  await borrower.mutation(api.board.requestLoan, args);
  await expect(
    borrower.mutation(api.board.requestLoan, args),
  ).rejects.toThrow();
});
test("reminder writebacks are idempotent and reject stale dates", async () => {
  const { t, owner, borrower } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  const loan = await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-06",
  });
  await owner.mutation(api.board.decide, { id: loan, approve: true });
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  const args = { loanId: loan, day: "2026-11-07" };
  expect(await t.mutation(internal.delivery.remind, args)).toEqual({
    recorded: true,
  });
  expect(await t.mutation(internal.delivery.remind, args)).toEqual({
    recorded: false,
  });
  expect(await t.query(internal.delivery.overdue, { day: args.day })).toEqual(
    [],
  );
  await expect(
    t.mutation(internal.delivery.remind, { ...args, day: "2026-11-08" }),
  ).rejects.toThrow();
});
test("signed automation HTTP rejects unsigned calls and accepts a valid signature", async () => {
  vi.stubEnv("AUTOMATION_SECRET", "a".repeat(40));
  const { t } = setup();
  expect((await t.fetch("/overdue")).status).toBe(401);
  const headers = await signRequest("a".repeat(40), "GET", "/overdue", "");
  const res = await t.fetch("/overdue", { headers });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});
test("HMAC rejects tampering, stale signatures and wrong routes", async () => {
  const secret = "x".repeat(40);
  const h = await signRequest(secret, "POST", "/reminders", "{}");
  const ts = h["x-lendloop-timestamp"],
    sig = h["x-lendloop-signature"];
  expect(await verifyRequest(secret, "POST", "/reminders", "{}", ts, sig)).toBe(
    true,
  );
  expect(
    await verifyRequest(secret, "POST", "/reminders", '{"changed":1}', ts, sig),
  ).toBe(false);
  expect(await verifyRequest(secret, "GET", "/overdue", "{}", ts, sig)).toBe(
    false,
  );
  expect(
    await verifyRequest(
      secret,
      "POST",
      "/reminders",
      "{}",
      ts,
      sig,
      Date.now() + 300001,
    ),
  ).toBe(false);
  expect((await signEnvelope(secret, "{}")).signature).toMatch(
    /^[a-f0-9]{64}$/,
  );
});
test("delivery claims lease once; delivered events cannot be claimed again", async () => {
  const { t, owner, borrower } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-06",
  });
  const event = await t.run((ctx) => ctx.db.query("events").first());
  const claimed = await t.mutation(internal.delivery.claim, { id: event!._id });
  expect(claimed.attempts).toBe(1);
  expect(
    await t.mutation(internal.delivery.claim, { id: event!._id }),
  ).toBeNull();
  await t.mutation(internal.delivery.settle, {
    id: event!._id,
    attempt: 1,
    ok: true,
  });
  expect(
    await t.mutation(internal.delivery.claim, { id: event!._id }),
  ).toBeNull();
});

test("retiring a listing declines pending requests but preserves approved history", async () => {
  const { t, owner, borrower, stranger } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  const a = await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-07",
  });
  const b = await stranger.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-10",
    end: "2026-11-12",
  });
  await owner.mutation(api.board.decide, { id: a, approve: true });
  await owner.mutation(api.board.removeTool, { id });
  expect((await borrower.query(api.board.dashboard, {})).loans[0].status).toBe(
    "approved",
  );
  expect((await stranger.query(api.board.dashboard, {})).loans[0].status).toBe(
    "declined",
  );
  expect(await t.query(api.board.publicTools, {})).toEqual([]);
  await expect(
    owner.mutation(api.board.decide, { id: b, approve: true }),
  ).rejects.toThrow();
});
test("delivery dead-letters exhausted events; stale attempts cannot acknowledge a newer claim", async () => {
  const { t, owner, borrower } = setup();
  const id = await owner.mutation(api.board.saveTool, fields);
  await borrower.mutation(api.board.requestLoan, {
    toolId: id,
    start: "2026-11-05",
    end: "2026-11-07",
  });
  const e = await t.run((ctx) => ctx.db.query("events").first());
  await t.run((ctx) => ctx.db.patch(e!._id, { attempts: 6, state: "pending" }));
  expect(await t.mutation(internal.delivery.claim, { id: e!._id })).toBeNull();
  expect((await t.run((ctx) => ctx.db.get(e!._id)))?.state).toBe("failed");
  await t.run((ctx) => ctx.db.patch(e!._id, { attempts: 2, state: "sending" }));
  await t.mutation(internal.delivery.settle, {
    id: e!._id,
    attempt: 1,
    ok: true,
  });
  expect((await t.run((ctx) => ctx.db.get(e!._id)))?.state).toBe("sending");
});
