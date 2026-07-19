import { describe, expect, it } from "vitest";

import { decryptMessage, encryptMessage, MESSAGE_SCHEME } from "../envelope";

describe("message envelope encryption", () => {
  it("round-trips plaintext with the correct passphrase", async () => {
    const envelope = await encryptMessage("hunter2-passphrase", "secret meeting at noon");
    expect(await decryptMessage("hunter2-passphrase", envelope)).toBe("secret meeting at noon");
  });

  it("produces an opaque envelope that does not contain the plaintext", async () => {
    const envelope = await encryptMessage("pw", "TOP SECRET PLAINTEXT");
    expect(envelope).not.toContain("TOP SECRET PLAINTEXT");
    const parsed = JSON.parse(envelope);
    expect(parsed.alg).toBe("AES-GCM");
    expect(parsed.ct).toBeTruthy();
  });

  it("returns null for a wrong passphrase (never throws)", async () => {
    const envelope = await encryptMessage("right", "hello");
    expect(await decryptMessage("wrong", envelope)).toBeNull();
  });

  it("returns null for a malformed envelope", async () => {
    expect(await decryptMessage("pw", "not json")).toBeNull();
    expect(await decryptMessage("pw", JSON.stringify({ v: 99 }))).toBeNull();
  });

  it("uses a fresh salt and iv each time (ciphertexts differ)", async () => {
    const a = await encryptMessage("pw", "same text");
    const b = await encryptMessage("pw", "same text");
    expect(a).not.toBe(b);
    expect(await decryptMessage("pw", a)).toBe("same text");
    expect(await decryptMessage("pw", b)).toBe("same text");
  });

  it("exposes the scheme id the server expects", () => {
    expect(MESSAGE_SCHEME).toBe("passphrase-v1");
  });
});
