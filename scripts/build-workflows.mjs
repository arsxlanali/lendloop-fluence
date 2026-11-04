// Generates n8n/*.json. The Code nodes live here as readable functions instead of escaped
// strings in JSON; run `npm run workflows` after changing them. No secrets are involved: the
// shared key is the "LendLoop automation JWT" credential, created in n8n by hand.
import { writeFileSync } from "node:fs";

const CREDENTIAL = { jwtAuth: { id: "LLjwtCredential1", name: "LendLoop automation JWT" } };
const ERROR_WORKFLOW_ID = "LLautomationErr1";
const code = (fn) => fn.toString().replace(/^[^{]*\{\n?/, "").replace(/\}\s*$/, "").replace(/^ {2}/gm, "").trim();

let x = 0;
const node = (name, type, typeVersion, parameters, extra = {}) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  type,
  typeVersion,
  position: [(x += 240), 0],
  parameters,
  ...extra,
});
const chain = (...names) =>
  Object.fromEntries(
    names.slice(0, -1).map((n, i) => [n, { main: [[{ node: names[i + 1], type: "main", index: 0 }]] }]),
  );

// Signs and sends one request to Convex: hash the exact body, put the hash, method, path and a
// five-minute expiry in a JWT signed by the credential, send it as a Bearer token.
function signedCall(prefix, requestNode) {
  return [
    node(`Hash ${prefix} body`, "n8n-nodes-base.crypto", 2, {
      action: "hash",
      type: "SHA256",
      value: "={{ $json.body }}",
      dataPropertyName: "bodySha256",
      encoding: "hex",
    }),
    node(`Sign ${prefix} request`, "n8n-nodes-base.jwt", 1, {
      operation: "sign",
      useJson: true,
      claimsJson:
        "={{ JSON.stringify({ iss: 'lendloop-n8n', aud: 'lendloop-convex', exp: Math.floor(Date.now() / 1000) + 300, method: 'POST', path: $json.path, body_sha256: $json.bodySha256 }) }}",
      options: {},
    }, { credentials: CREDENTIAL }),
    node(`Send ${prefix} to Convex`, "n8n-nodes-base.httpRequest", 4.2, {
      method: "POST",
      url: `={{ $env.CONVEX_SITE_URL.replace(/\\/$/, '') + $('${requestNode}').item.json.path }}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Authorization", value: "=Bearer {{ $json.token }}" }],
      },
      sendBody: true,
      contentType: "raw",
      rawContentType: "application/json",
      body: `={{ $('${requestNode}').item.json.body }}`,
      options: { timeout: 15000 },
    }, { retryOnFail: true, maxTries: 5, waitBetweenTries: 5000 }),
  ];
}

const settings = (extra = {}) => ({
  executionOrder: "v1",
  saveDataErrorExecution: "all",
  saveDataSuccessExecution: "none",
  saveManualExecutions: true,
  executionTimeout: 120,
  timezone: "UTC",
  ...extra,
});
const meta = { description: "LendLoop. Notifications are logged mocks. No secrets in this file." };

function write(file, workflow) {
  writeFileSync(new URL(`../n8n/${file}`, import.meta.url), JSON.stringify(workflow, null, 2) + "\n");
}

// 1. Convex -> n8n: request status notifications ------------------------------------------
x = -240;
function checkEvent() {
  // The Webhook node already verified the JWT signature and expiry with the credential.
  const item = $input.first().json;
  const claims = item.jwtPayload ?? {};
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== "lendloop-convex" ||
    claims.aud !== "lendloop-n8n" ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    claims.exp - claims.iat > 300
  )
    throw new Error("Token claims rejected");
  const payload = item.body?.payload;
  if (typeof payload !== "string" || payload.length > 4096 || claims.body_sha256 !== item.payloadSha256)
    throw new Error("Payload does not match its signature");
  const event = JSON.parse(payload);
  const kinds = ["requested", "approved", "declined", "cancelled", "expired", "return_reported", "return_disputed", "returned", "booking_cancelled", "listing_removed"];
  if (!kinds.includes(event.kind) || event.eventId !== claims.jti || typeof event.recipient?.name !== "string")
    throw new Error("Unexpected event");
  return [{ json: { event } }];
}
function sendNotification() {
  const { event } = $input.first().json;
  // Delivery is at-least-once: Convex retries until it gets a 200. Remember recent event IDs so
  // a retry after a lost response doesn't notify twice. (Saved for production executions.)
  const memory = $getWorkflowStaticData("global");
  memory.sent = memory.sent ?? {};
  const now = Date.now();
  for (const [id, at] of Object.entries(memory.sent)) if (now - at > 2 * 86400000) delete memory.sent[id];
  if (memory.sent[event.eventId]) return [{ json: { accepted: true, duplicate: true } }];
  const dates = event.loan ? ` (${event.loan.start} to ${event.loan.end})` : "";
  const subjects = {
    requested: `New request to borrow your ${event.tool.name}${dates}`,
    approved: `Your request for the ${event.tool.name} was approved${dates}`,
    declined: `Your request for the ${event.tool.name} was declined`,
    cancelled: `A request for your ${event.tool.name} was cancelled`,
    expired: `Your request for the ${event.tool.name} expired`,
    return_reported: `The borrower says your ${event.tool.name} is back: please confirm`,
    return_disputed: `The owner says the ${event.tool.name} isn't back yet`,
    booking_cancelled: `The booking for the ${event.tool.name}${dates} was cancelled`,
    returned: `Return of the ${event.tool.name} confirmed. Thanks!`,
    listing_removed: `An admin removed your listing "${event.tool.name}"`,
  };
  const email = event.recipient.email;
  // Mock delivery: a real email/Slack node goes here and gets event.eventId as its idempotency key.
  // The log masks the address; no other personal data is written.
  console.log("lendloop.notification.mock", {
    eventId: event.eventId,
    to: email ? email.replace(/^(.).*@/, "$1***@") : "(no email on file)",
    subject: subjects[event.kind],
  });
  memory.sent[event.eventId] = now;
  return [{ json: { accepted: true } }];
}
write("request-notification.json", {
  id: "LLnotifyEvents01",
  name: "LendLoop - Request notifications",
  active: false,
  nodes: [
    node("Request webhook", "n8n-nodes-base.webhook", 2.1, {
      httpMethod: "POST",
      path: "lendloop-events",
      authentication: "jwtAuth",
      responseMode: "responseNode",
      options: {},
    }, { webhookId: "5f0c3a8e-6b1d-4c55-9a59-3e0f3f2f7a11", credentials: CREDENTIAL }),
    node("Hash payload", "n8n-nodes-base.crypto", 2, {
      action: "hash",
      type: "SHA256",
      value: "={{ $json.body.payload }}",
      dataPropertyName: "payloadSha256",
      encoding: "hex",
    }),
    node("Check event", "n8n-nodes-base.code", 2, { jsCode: code(checkEvent) }),
    node("Send notification (mock)", "n8n-nodes-base.code", 2, { jsCode: code(sendNotification) }),
    node("Acknowledge", "n8n-nodes-base.respondToWebhook", 1.4, {
      respondWith: "json",
      responseBody: "={{ $json }}",
      options: { responseCode: 200 },
    }),
  ],
  connections: chain("Request webhook", "Hash payload", "Check event", "Send notification (mock)", "Acknowledge"),
  settings: settings({ errorWorkflow: ERROR_WORKFLOW_ID }),
  pinData: {},
  meta,
});

// 2. n8n -> Convex: overdue reminders ----------------------------------------------------------
x = -240;
function claimRequest() {
  return [{ json: { path: "/automation/reminders/claim", body: "{}" } }];
}
function sendReminders() {
  const response = $input.first().json;
  if (!Array.isArray(response.reminders)) throw new Error("Unexpected claim response");
  const results = [];
  for (const r of response.reminders) {
    try {
      if (!r.recipient?.email) throw new Error("No email address on file");
      const subject = `Reminder: the ${r.tool.name} was due back on ${r.dueDate}`;
      // Mock delivery: a real email/Slack node goes here with r.idempotencyKey as its idempotency key.
      console.log("lendloop.reminder.mock", {
        key: r.idempotencyKey,
        to: r.recipient.email.replace(/^(.).*@/, "$1***@"),
        subject,
      });
      results.push({ loanId: r.loanId, day: r.day, status: "sent" });
    } catch (error) {
      results.push({ loanId: r.loanId, day: r.day, status: "failed", error: String(error.message).slice(0, 200) });
    }
  }
  return [
    {
      json: {
        path: "/automation/reminders/report",
        body: JSON.stringify({ results }),
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
    },
  ];
}
function finish() {
  const { more, failedToday } = $input.first().json;
  // Failed reminders are recorded in Convex (and shown on each loan). Failing the execution
  // as well hands it to the error workflow, so an admin sees it in the app.
  if (more) throw new Error("Stopped after 50 batches with overdue loans left; run again to continue");
  if (failedToday > 0) throw new Error(`${failedToday} reminder(s) failed today; see the admin page`);
  return [{ json: { failedToday } }];
}
write("overdue-reminders.json", {
  id: "LLoverdueRemind1",
  name: "LendLoop - Overdue reminders",
  active: false,
  nodes: [
    node("Daily 09:00 UTC", "n8n-nodes-base.scheduleTrigger", 1.2, {
      rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] },
    }),
    node("Claim request", "n8n-nodes-base.code", 2, { jsCode: code(claimRequest) }),
    ...signedCall("claim", "Claim request"),
    node("Send reminders (mock)", "n8n-nodes-base.code", 2, { jsCode: code(sendReminders) }),
    ...signedCall("report", "Send reminders (mock)"),
    // Convex says whether overdue loans are still waiting; claim the next batch of 100 until
    // none are left. 50 passes (5,000 reminders) at most per run.
    node("More overdue loans?", "n8n-nodes-base.if", 1, {
      conditions: { boolean: [{ value1: "={{ $json.more === true && $runIndex < 49 }}", value2: true }] },
    }),
    node("Finish", "n8n-nodes-base.code", 2, { jsCode: code(finish) }),
  ],
  connections: {
    ...chain(
      "Daily 09:00 UTC",
      "Claim request",
      "Hash claim body",
      "Sign claim request",
      "Send claim to Convex",
      "Send reminders (mock)",
      "Hash report body",
      "Sign report request",
      "Send report to Convex",
      "More overdue loans?",
    ),
    "More overdue loans?": {
      main: [
        [{ node: "Claim request", type: "main", index: 0 }],
        [{ node: "Finish", type: "main", index: 0 }],
      ],
    },
  },
  settings: settings({ errorWorkflow: ERROR_WORKFLOW_ID }),
  pinData: {},
  meta,
});

// 3. Error workflow: every failed run is reported to Convex and shown to admins -------------
x = -240;
function buildReport() {
  const e = $input.first().json;
  const report = {
    executionId: String(e.execution?.id ?? `trigger-${e.trigger?.error?.timestamp ?? Date.now()}`),
    workflow: String(e.workflow?.name ?? "unknown workflow"),
    node: String(e.execution?.lastNodeExecuted ?? e.trigger?.node?.name ?? "trigger"),
    message: String(e.execution?.error?.message ?? e.trigger?.error?.message ?? "Unknown error").slice(0, 300),
  };
  console.error("lendloop.workflow.failed", report);
  return [{ json: { path: "/automation/failures", body: JSON.stringify(report) } }];
}
write("error-workflow.json", {
  id: ERROR_WORKFLOW_ID,
  name: "LendLoop - Report automation failures",
  active: false,
  nodes: [
    node("Workflow failed", "n8n-nodes-base.errorTrigger", 1, {}),
    node("Build failure report", "n8n-nodes-base.code", 2, { jsCode: code(buildReport) }),
    ...signedCall("failure", "Build failure report"),
  ],
  connections: chain("Workflow failed", "Build failure report", "Hash failure body", "Sign failure request", "Send failure to Convex"),
  settings: settings(),
  pinData: {},
  meta,
});
