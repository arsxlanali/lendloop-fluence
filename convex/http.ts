import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyFromN8n } from "../lib/signing";

const MAX_BODY = 64 * 1024;

// Every route: POST only, size-limited, and a token signed by n8n's JWT credential that binds
// this method, path and body hash and expires within five minutes. No CORS headers: browsers
// have no business calling these.
function signedRoute(handle: (ctx: ActionCtx, input: Record<string, unknown>) => Promise<unknown>) {
  return httpAction(async (ctx, request) => {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
      return new Response("Too large", { status: 413 });
    const body = await request.text();
    if (body.length > MAX_BODY) return new Response("Too large", { status: 413 });
    const secret = process.env.AUTOMATION_SECRET;
    const path = new URL(request.url).pathname;
    if (
      !secret ||
      !(await verifyFromN8n(secret, request.headers.get("authorization"), {
        method: request.method,
        path,
        body,
      }))
    )
      return new Response("Unauthorized", { status: 401 });
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return new Response("Bad request", { status: 400 });
    try {
      return Response.json(await handle(ctx, input as Record<string, unknown>));
    } catch (error) {
      // Argument validation failures land here; the details stay in the Convex logs.
      console.error("automation.request.rejected", { path, message: String(error).slice(0, 200) });
      return new Response("Bad request", { status: 400 });
    }
  });
}

const http = httpRouter();

http.route({
  path: "/automation/reminders/claim",
  method: "POST",
  handler: signedRoute((ctx, input) =>
    ctx.runMutation(internal.automation.claimReminders, {
      limit: typeof input.limit === "number" ? input.limit : 100,
    }),
  ),
});

http.route({
  path: "/automation/reminders/report",
  method: "POST",
  handler: signedRoute((ctx, input) =>
    ctx.runMutation(internal.automation.reportReminders, {
      results: input.results as never,
    }),
  ),
});

http.route({
  path: "/automation/failures",
  method: "POST",
  handler: signedRoute((ctx, input) =>
    ctx.runMutation(internal.automation.recordFailure, {
      executionId: String(input.executionId ?? ""),
      workflow: String(input.workflow ?? ""),
      node: String(input.node ?? ""),
      message: String(input.message ?? ""),
    }),
  ),
});

export default http;
