import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const files = ["request-notification.json", "overdue-reminders.json", "error-workflow.json"];
const load = (file: string) => JSON.parse(readFileSync(new URL(`../n8n/${file}`, import.meta.url), "utf8"));
const code = (file: string, name: string) =>
  load(file).nodes.find((n: { name: string }) => n.name === name).parameters.jsCode as string;

function run(js: string, json: unknown, extra: Record<string, unknown> = {}) {
  const log = vi.fn();
  const result = runInNewContext(`(function(){${js}})()`, {
    Date,
    JSON,
    String,
    Object,
    Array,
    Error,
    console: { log, error: log },
    $input: { first: () => ({ json }) },
    ...extra,
  });
  return { result, log };
}

test("exports match the generator and hold no secrets", () => {
  const before = files.map((f) => readFileSync(new URL(`../n8n/${f}`, import.meta.url), "utf8"));
  execFileSync(process.execPath, ["scripts/build-workflows.mjs"]);
  expect(files.map((f) => readFileSync(new URL(`../n8n/${f}`, import.meta.url), "utf8"))).toEqual(before);
  for (const file of files) {
    const text = readFileSync(new URL(`../n8n/${file}`, import.meta.url), "utf8");
    expect(text).not.toMatch(/AUTOMATION_SECRET|ENCRYPTION_KEY|require\(|passphrase|"secret"/);
    const workflow = JSON.parse(text);
    for (const n of workflow.nodes.filter((n: { type: string }) => /jwt|webhook/.test(n.type)))
      expect(n.credentials).toEqual({ jwtAuth: { id: "LLjwtCredential1", name: "LendLoop automation JWT" } });
    if (file !== "error-workflow.json") expect(workflow.settings.errorWorkflow).toBe("LLautomationErr1");
  }
  const webhook = load("request-notification.json").nodes[0];
  expect(webhook.parameters.authentication).toBe("jwtAuth");
});

const event = {
  eventId: "evt1",
  kind: "approved",
  recipient: { name: "Ben", email: "ben@example.com" },
  tool: { name: "Tent" },
  loan: { start: "2026-11-05", end: "2026-11-07" },
};
const now = Math.floor(Date.now() / 1000);
const claims = { iss: "lendloop-convex", aud: "lendloop-n8n", iat: now, exp: now + 300, jti: "evt1", body_sha256: "abc" };

test("the receiver checks claims, the payload hash and the event", () => {
  const js = code("request-notification.json", "Check event");
  const item = { jwtPayload: claims, payloadSha256: "abc", body: { payload: JSON.stringify(event) } };
  expect(run(js, item).result[0].json.event).toEqual(event);
  expect(() => run(js, { ...item, payloadSha256: "different" })).toThrow(/does not match/);
  expect(() => run(js, { ...item, jwtPayload: { ...claims, iss: "x" } })).toThrow(/claims/);
  expect(() => run(js, { ...item, jwtPayload: { ...claims, exp: now + 3600 } })).toThrow(/claims/);
  expect(() => run(js, { ...item, jwtPayload: { ...claims, jti: "evt2" } })).toThrow(/Unexpected event/);
  expect(() => run(js, { ...item, jwtPayload: undefined })).toThrow(/claims/);
  const note = { ...event, kind: "message" };
  const accepted = run(js, { ...item, body: { payload: JSON.stringify(note) } }).result[0].json.event;
  expect(accepted.kind).toBe("message");
});

test("a redelivered event is not notified twice, and the log masks the address", () => {
  const js = code("request-notification.json", "Send notification (mock)");
  const memory = {};
  const extra = { $getWorkflowStaticData: () => memory };
  const first = run(js, { event }, extra);
  expect(first.result[0].json).toEqual({ accepted: true });
  expect(JSON.stringify(first.log.mock.calls)).toContain("b***@example.com");
  expect(JSON.stringify(first.log.mock.calls)).not.toContain("ben@example.com");
  const again = run(js, { event }, extra);
  expect(again.result[0].json).toEqual({ accepted: true, duplicate: true });
  expect(again.log).not.toHaveBeenCalled();
});

test("reminders: each one reports sent or failed, and failures fail the run", () => {
  const reminder = (loanId: string, email: string | null) => ({
    loanId,
    day: "2026-11-08",
    idempotencyKey: `reminder:${loanId}:2026-11-08`,
    recipient: { name: "Ben", email },
    tool: { name: "Tent" },
    dueDate: "2026-11-06",
    daysOverdue: 2,
  });
  const send = code("overdue-reminders.json", "Send reminders (mock)");
  const { result } = run(send, { day: "2026-11-08", reminders: [reminder("a", "ben@example.com"), reminder("b", null)] });
  const out = result[0].json;
  expect(out.path).toBe("/automation/reminders/report");
  expect(JSON.parse(out.body).results).toEqual([
    { loanId: "a", day: "2026-11-08", status: "sent" },
    { loanId: "b", day: "2026-11-08", status: "failed", error: "No email address on file" },
  ]);
  const finish = code("overdue-reminders.json", "Finish");
  expect(() => run(finish, { more: false, failedToday: 2 })).toThrow(/2 reminder\(s\) failed today/);
  expect(() => run(finish, { more: true, failedToday: 0 })).toThrow(/Stopped after 50 batches/);
  expect(run(finish, { more: false, failedToday: 0 }).result[0].json).toEqual({ failedToday: 0 });
  expect(() => run(send, { error: "nope" })).toThrow(/Unexpected claim response/);
});

test("the reminder workflow runs daily and loops while Convex has more", () => {
  const w = load("overdue-reminders.json");
  expect(w.nodes[0].parameters.rule.interval[0].expression).toBe("0 9 * * *");
  const loop = w.nodes.find((n: { name: string }) => n.name === "More overdue loans?");
  expect(loop.parameters.conditions.boolean[0].value1).toContain("$json.more === true && $runIndex < 49");
  expect(w.connections["More overdue loans?"].main.map((o: { node: string }[]) => o[0].node)).toEqual(["Claim request", "Finish"]);
});

test("the error workflow builds a bounded failure report", () => {
  const js = code("error-workflow.json", "Build failure report");
  const { result } = run(js, {
    workflow: { name: "LendLoop - Overdue reminders" },
    execution: { id: "17", lastNodeExecuted: "Send report to Convex", error: { message: "x".repeat(1000) } },
  });
  const report = JSON.parse(result[0].json.body);
  expect(result[0].json.path).toBe("/automation/failures");
  expect(report).toMatchObject({ executionId: "17", workflow: "LendLoop - Overdue reminders", node: "Send report to Convex" });
  expect(report.message).toHaveLength(300);
});
