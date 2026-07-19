/**
 * Honest encryption state. This banner must not be removed or reworded to
 * imply E2EE until Milestone 3 ships verified end-to-end encryption
 * (ADR-0003). Transport encryption ≠ E2EE.
 */
export function EncryptionNotice() {
  return (
    <div
      role="note"
      aria-label="Encryption status"
      className="rounded-md border border-amber-600/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200"
    >
      <p className="font-medium">Transport encryption only — not end-to-end encrypted.</p>
      <p className="mt-1 text-amber-200/80">
        Audio is encrypted between your browser and this server, but the server operator can
        access it. End-to-end encryption is planned and not yet available.
      </p>
    </div>
  );
}
