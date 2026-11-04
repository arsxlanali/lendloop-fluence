// HS256 JSON Web Tokens shared with n8n. n8n keeps the same secret in a "JWT Auth" credential:
// its Webhook node verifies our tokens and its JWT node signs the calls it makes back to us,
// so the secret never sits in workflow JSON, Code nodes or n8n's environment.
//
// Every token binds the exact request: a SHA-256 of the body (and, towards Convex, the method
// and path), a five-minute expiry, an issuer and an audience. A token for one request cannot
// be replayed against another route or with a different body.

export const CONVEX_ISSUER = "lendloop-convex";
export const N8N_ISSUER = "lendloop-n8n";
export const MAX_TOKEN_SECONDS = 300;

export type Claims = {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti?: string;
  method?: string;
  path?: string;
  body_sha256: string;
};

const enc = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function key(secret: string) {
  if (secret.length < 32)
    throw new Error("AUTOMATION_SECRET must contain at least 32 characters");
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sha256Hex(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signToken(secret: string, claims: Claims) {
  const head = base64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(sig))}`;
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

// Checks a token n8n sent with a request to us. Returns the claims or null; never throws on
// attacker-controlled input.
export async function verifyFromN8n(
  secret: string,
  authorization: string | null,
  request: { method: string; path: string; body: string },
  now = Date.now(),
): Promise<Claims | null> {
  const token = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(authorization ?? "")?.[1];
  if (!token) return null;
  const [head, body, sig] = token.split(".");
  let header: { alg?: unknown };
  let claims: Partial<Claims>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(head)));
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    // crypto.subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      fromBase64url(sig),
      enc.encode(`${head}.${body}`),
    );
    if (!valid || header.alg !== "HS256") return null;
  } catch {
    return null;
  }
  const seconds = Math.floor(now / 1000);
  const ok =
    claims.iss === N8N_ISSUER &&
    claims.aud === CONVEX_ISSUER &&
    typeof claims.iat === "number" &&
    typeof claims.exp === "number" &&
    claims.exp > seconds &&
    claims.iat <= seconds + 30 &&
    claims.exp - claims.iat <= MAX_TOKEN_SECONDS &&
    claims.method === request.method &&
    claims.path === request.path &&
    claims.body_sha256 === (await sha256Hex(request.body));
  return ok ? (claims as Claims) : null;
}
