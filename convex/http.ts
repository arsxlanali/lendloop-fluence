import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyRequest } from "../lib/signing";
const http = httpRouter();
const handler = httpAction(async (ctx, request) => {
  const path = new URL(request.url).pathname;
  const body = await request.text();
  if (body.length > 4096) return new Response("Too large", { status: 413 });
  const secret = process.env.AUTOMATION_SECRET;
  if (
    !secret ||
    !(await verifyRequest(
      secret,
      request.method,
      path,
      body,
      request.headers.get("x-lendloop-timestamp") ?? "",
      request.headers.get("x-lendloop-signature") ?? "",
    ))
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    if (request.method === "GET")
      return Response.json(
        await ctx.runQuery(internal.delivery.overdue, {
          day: new Date().toISOString().slice(0, 10),
        }),
      );
    const input = JSON.parse(body);
    if (typeof input.loanId !== "string" || typeof input.day !== "string")
      return new Response("Bad request", { status: 400 });
    return Response.json(
      await ctx.runMutation(internal.delivery.remind, {
        loanId: input.loanId,
        day: input.day,
      }),
    );
  } catch {
    return new Response("Invalid automation request", { status: 400 });
  }
});
http.route({ path: "/overdue", method: "GET", handler });
http.route({ path: "/reminders", method: "POST", handler });
export default http;
