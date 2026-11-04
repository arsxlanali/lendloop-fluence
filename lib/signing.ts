// HS256 JSON Web Tokens shared with n8n, via the `jose` library. n8n keeps the same secret in a
// "JWT Auth" credential: its Webhook node verifies our tokens and its JWT node signs the calls it
// makes back to us, so the secret never sits in workflow JSON, Code nodes or n8n's environment.
//
// Every token binds the exact request: a SHA-256 of the body (and, towards Convex, the method
// and path), a lifetime of at most five minutes, an issuer and an audience. A token for one
// request cannot be replayed against another route or with a different body.
import { jwtVerify, SignJWT, type JWTPayload } from "jose";

export const CONVEX_ISSUER = "lendloop-convex";
export const N8N_ISSUER = "lendloop-n8n";
export const MAX_TOKEN_SECONDS = 300;

function key(secret: string) {
  if (secret.length < 32)
    throw new Error("AUTOMATION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function sha256Hex(text: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Signs arbitrary claims. Used for our tokens to n8n, and by tests to impersonate n8n.
export async function signToken(secret: string, claims: JWTPayload) {
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(key(secret));
}

// Token for a request we send to n8n.
export async function tokenForN8n(secret: string, payload: string, jti: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  return signToken(secret, {
    iss: CONVEX_ISSUER,
    aud: N8N_ISSUER,
    iat,
    exp: iat + MAX_TOKEN_SECONDS,
    jti,
    body_sha256: await sha256Hex(payload),
  });
}

// Checks a token n8n sent with a request to us. Returns the claims, or null for anything
// invalid; never throws on attacker-controlled input.
export async function verifyFromN8n(
  secret: string,
  authorization: string | null,
  request: { method: string; path: string; body: string },
  now = Date.now(),
) {
  const token = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: N8N_ISSUER,
      audience: CONVEX_ISSUER,
      requiredClaims: ["iat", "exp"],
      maxTokenAge: MAX_TOKEN_SECONDS,
      clockTolerance: 5, // seconds of clock skew allowed between n8n and Convex
      currentDate: new Date(now),
    });
    const ok =
      payload.exp! - payload.iat! <= MAX_TOKEN_SECONDS &&
      payload.method === request.method &&
      payload.path === request.path &&
      payload.body_sha256 === (await sha256Hex(request.body));
    return ok ? payload : null;
  } catch {
    return null;
  }
}
