const enc = new TextEncoder();
async function hmac(secret: string, message: string) {
  if (secret.length < 32)
    throw new Error("AUTOMATION_SECRET must contain at least 32 characters");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function signEnvelope(
  secret: string,
  payload: string,
  timestamp = Date.now(),
) {
  return {
    timestamp,
    payload,
    signature: await hmac(secret, `${timestamp}\n${payload}`),
  };
}
export async function verifyRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp: string,
  signature: string,
  now = Date.now(),
) {
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000)
    return false;
  return equal(
    await hmac(secret, `${timestamp}\n${method}\n${path}\n${body}`),
    signature,
  );
}
export async function signRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp = Date.now(),
) {
  return {
    "x-lendloop-timestamp": String(timestamp),
    "x-lendloop-signature": await hmac(
      secret,
      `${timestamp}\n${method}\n${path}\n${body}`,
    ),
  };
}
