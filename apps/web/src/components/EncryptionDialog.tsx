import { useEffect } from "react";

/**
 * On-demand encryption explanation (opened from the header). Kept accurate and
 * honest but out of the way — the always-visible states live where they
 * matter: the voice call screen and the message-passphrase field.
 */
export function EncryptionDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About encryption"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-6 text-sm text-slate-300"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">About encryption</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <p>
          <span className="font-medium text-slate-100">Voice calls</span> are end-to-end encrypted
          when everyone in the call enters the same passphrase — the server and its operator can't
          hear you. Without a passphrase, voice is transport-encrypted only and the server can
          access it. The call screen always shows which one you're in.
        </p>
        <p>
          <span className="font-medium text-slate-100">Text messages</span> are end-to-end
          encrypted when you set a channel passphrase — the server stores only ciphertext. Without a
          passphrase, messages are transport-encrypted only and the server operator can read them.
        </p>
        <p className="text-slate-400">
          Passphrases are shared by you, outside this app, and there's no automatic key rotation
          yet, so anyone with the passphrase and channel access can read the content. Either way the
          server can always see metadata: who is in which community and channel, timing, and volume.
        </p>
      </div>
    </div>
  );
}
