import type { VoiceErrorInfo } from "../voice/errors";
import type { VoiceStatus } from "../voice/useVoiceRoom";

const STATUS_TEXT: Record<VoiceStatus, string | null> = {
  idle: null,
  "requesting-token": "Authorizing…",
  connecting: "Connecting to voice…",
  connected: "Connected",
  reconnecting: "Connection lost — reconnecting…",
  disconnected: "Disconnected from voice.",
};

const STATUS_CLASS: Record<VoiceStatus, string> = {
  idle: "",
  "requesting-token": "border-sky-700/50 bg-sky-950/40 text-sky-200",
  connecting: "border-sky-700/50 bg-sky-950/40 text-sky-200",
  connected: "border-emerald-700/50 bg-emerald-950/40 text-emerald-200",
  reconnecting: "border-amber-600/50 bg-amber-950/40 text-amber-200",
  disconnected: "border-red-700/50 bg-red-950/40 text-red-200",
};

export function ConnectionBanner({
  status,
  error,
}: {
  status: VoiceStatus;
  error: VoiceErrorInfo | null;
}) {
  const text = STATUS_TEXT[status];
  return (
    <div aria-live="polite" className="space-y-2">
      {text && (
        <p
          data-testid="connection-status"
          className={`rounded-md border px-3 py-2 text-sm ${STATUS_CLASS[status]}`}
        >
          {text}
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid="voice-error"
          className="rounded-md border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200"
        >
          {error.message}
        </p>
      )}
    </div>
  );
}
