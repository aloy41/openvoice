/**
 * Honest encryption state (ADR-0003 / ADR-0006). This banner must never
 * overstate protection. Voice calls can opt into passphrase E2EE — that
 * state is shown per call in the voice workspace; everything else is
 * transport-encrypted only.
 */
export function EncryptionNotice() {
  return (
    <div
      role="note"
      aria-label="Encryption status"
      className="rounded-md border border-amber-600/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200"
    >
      <p className="font-medium">
        Messages are not end-to-end encrypted. Voice can be, with a passphrase.
      </p>
      <p className="mt-1 text-amber-200/80">
        Text messages are encrypted in transit only — the server operator can access them.
        Voice calls are end-to-end encrypted when everyone enters the same call passphrase
        (see the voice channel screen); otherwise they are transport-encrypted only.
      </p>
    </div>
  );
}
