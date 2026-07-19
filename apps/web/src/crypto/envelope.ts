/**
 * Client-side message encryption (ADR-0006 semantics for text).
 *
 * AES-GCM content encryption with a PBKDF2-derived key, all via the
 * platform's Web Crypto — no custom cryptography. The passphrase and derived
 * key never leave the browser; the server stores and returns the opaque
 * envelope produced here and can neither read it nor derive the key.
 *
 * Envelope (JSON, then the whole string is what the server stores as
 * `content` with scheme "passphrase-v1"):
 *   { v:1, kdf:"PBKDF2-SHA256", it:210000, alg:"AES-GCM",
 *     salt:<b64>, iv:<b64>, ct:<b64> }
 */

export const MESSAGE_SCHEME = "passphrase-v1";
const PBKDF2_ITERATIONS = 210_000;

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function deriveKey(passphrase: string, salt: BufferSource): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(passphrase: string, plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return JSON.stringify({
    v: 1,
    kdf: "PBKDF2-SHA256",
    it: PBKDF2_ITERATIONS,
    alg: "AES-GCM",
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
  });
}

/** Decrypt an envelope. Returns null on a wrong passphrase or malformed
 * envelope — callers render a "can't decrypt" placeholder, never throw. */
export async function decryptMessage(
  passphrase: string,
  envelope: string,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(envelope) as {
      v?: number;
      it?: number;
      salt?: string;
      iv?: string;
      ct?: string;
    };
    if (parsed.v !== 1 || !parsed.salt || !parsed.iv || !parsed.ct) return null;
    const salt = fromB64(parsed.salt);
    const iv = fromB64(parsed.iv);
    const key = await deriveKey(passphrase, salt);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, fromB64(parsed.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
