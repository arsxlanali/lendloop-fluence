import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { signEnvelope, verifyRequest } from "../lib/signing";
const require = createRequire(import.meta.url);
function code(file: string, name: string) {
  const workflow = JSON.parse(
    readFileSync(new URL(`../n8n/${file}`, import.meta.url), "utf8"),
  );
  return workflow.nodes.find((n: { name: string }) => n.name === name)
    .parameters.jsCode;
}
function execute(js: string, json: unknown, env: Record<string, string>) {
  return runInNewContext(`(function(){${js}})()`, {
    require,
    Buffer,
    Date,
    console: { log: vi.fn(), error: vi.fn() },
    $input: { first: () => ({ json }) },
    $env: env,
  });
}
const secret = "safe-development-test-secret-not-for-production";
test("n8n receiver interoperates with Convex HMAC and rejects tampered payloads", async () => {
  const event = {
    eventId: "evt1",
    loanId: "loan1",
    recipient: "borrower",
    kind: "requested",
  };
  const envelope = await signEnvelope(secret, JSON.stringify(event));
  const js = code("request-notification.json", "Verify and log mock");
  expect(
    execute(js, { body: envelope }, { AUTOMATION_SECRET: secret })[0].json
      .accepted,
  ).toBe(true);
  expect(() =>
    execute(
      js,
      {
        body: {
          ...envelope,
          payload: JSON.stringify({ ...event, kind: "approved" }),
        },
      },
      { AUTOMATION_SECRET: secret },
    ),
  ).toThrow();
});
test("n8n overdue-read and writeback signatures match HTTP verifier", async () => {
  const env = {
    AUTOMATION_SECRET: secret,
    CONVEX_SITE_URL: "https://example.convex.site",
  };
  const read = execute(
    code("overdue-reminders.json", "Sign overdue read"),
    {},
    env,
  )[0].json;
  expect(
    await verifyRequest(
      secret,
      "GET",
      "/overdue",
      "",
      read.timestamp,
      read.signature,
    ),
  ).toBe(true);
  const items = execute(
    code("overdue-reminders.json", "Log mock and sign writeback"),
    { body: [{ loanId: "loan1", recipient: "borrower", day: "2026-11-04" }] },
    env,
  );
  const write = items[0].json;
  expect(
    await verifyRequest(
      secret,
      "POST",
      "/reminders",
      write.body,
      write.timestamp,
      write.signature,
    ),
  ).toBe(true);
  expect(JSON.parse(write.body)).toEqual({
    loanId: "loan1",
    day: "2026-11-04",
  });
  expect(
    execute(
      code("overdue-reminders.json", "Log mock and sign writeback"),
      { body: [] },
      env,
    ),
  ).toHaveLength(0);
});
