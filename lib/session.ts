// Signed session cookie using Web Crypto (crypto.subtle) rather than
// Node's `crypto` module, so the exact same code works in both the
// middleware (Edge Runtime, no Node crypto) and Server Actions (Node
// runtime, which also exposes crypto.subtle globally since Node 18) —
// one implementation instead of two runtime-specific ones.

export const SESSION_COOKIE_NAME = "skrybix_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(secret: string): Promise<string> {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
  const payloadB64 = base64url(encoder.encode(payload));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  return `${payloadB64}.${base64url(sig)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return false;

  const key = await getKey(secret);
  const sigBytes = base64urlToBytes(sigB64);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes.buffer as ArrayBuffer, encoder.encode(payloadB64));
  if (!valid) return false;

  try {
    const payload = JSON.parse(decoder.decode(base64urlToBytes(payloadB64)));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export { SESSION_MAX_AGE_SECONDS };
