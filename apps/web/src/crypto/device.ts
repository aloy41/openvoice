/**
 * Per-device identity key (ADR-0007).
 *
 * An ECDSA P-256 keypair is generated in the browser; the PRIVATE key is
 * stored non-extractable in IndexedDB and never leaves this device. Only the
 * SPKI-encoded public key is registered with the server. This is the
 * foundation MLS device credentials will build on.
 *
 * Storage caveat (documented in the threat model): browser storage can be
 * cleared, which loses the device key — the user simply registers a new
 * device. Desktop builds will use OS secure storage instead.
 */

const DB_NAME = "openvoice";
const STORE = "device";
const KEY_ID = "identity-keypair";

export const DEVICE_KEY_TYPE = "ecdsa-p256";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function toB64(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

async function loadOrCreateKeyPair(): Promise<CryptoKeyPair> {
  const existing = await idbGet<CryptoKeyPair>(KEY_ID);
  if (existing) return existing;
  // Private key is NON-extractable: it can sign but can never be read out of
  // the browser, not even by our own code.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  await idbPut(KEY_ID, pair);
  return pair;
}

/** Coarse, human-readable device label (never a fine-grained fingerprint). */
function deviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg/.test(ua)
    ? "Edge"
    : /Chrome/.test(ua)
      ? "Chrome"
      : /Firefox/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "device";
  return `${browser} on ${os}`;
}

export interface LocalDeviceIdentity {
  publicKeyB64: string;
  keyType: string;
  name: string;
}

/** Get this browser's device identity, creating and persisting it on first
 * use. Returns the public key + a suggested name for registration. */
export async function getLocalDeviceIdentity(): Promise<LocalDeviceIdentity> {
  const pair = await loadOrCreateKeyPair();
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return { publicKeyB64: toB64(spki), keyType: DEVICE_KEY_TYPE, name: deviceName() };
}

const CURRENT_DEVICE_ID = "current-device-id";

export async function rememberCurrentDeviceId(id: string): Promise<void> {
  await idbPut(CURRENT_DEVICE_ID, id);
}

export async function getCurrentDeviceId(): Promise<string | null> {
  return (await idbGet<string>(CURRENT_DEVICE_ID)) ?? null;
}
