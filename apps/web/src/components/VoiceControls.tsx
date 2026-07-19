import type { VoiceStatus } from "../voice/useVoiceRoom";

export interface VoiceControlsProps {
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
}

/** Presentational call controls. Buttons are native, keyboard-operable, and
 * expose their toggle state via aria-pressed. */
export function VoiceControls({
  status,
  muted,
  deafened,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleDeafen,
}: VoiceControlsProps) {
  const inRoom = status === "connected" || status === "reconnecting";
  const joining = status === "requesting-token" || status === "connecting";

  if (!inRoom) {
    return (
      <div className="flex gap-3">
        <button
          onClick={onJoin}
          disabled={joining}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {joining ? "Joining…" : status === "disconnected" ? "Rejoin voice" : "Join voice"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3" role="group" aria-label="Call controls">
      <button
        onClick={onToggleMute}
        aria-pressed={muted}
        className={`rounded-md border px-4 py-2 text-sm font-medium ${
          muted
            ? "border-red-700 bg-red-950/60 text-red-200"
            : "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
        }`}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <button
        onClick={onToggleDeafen}
        aria-pressed={deafened}
        className={`rounded-md border px-4 py-2 text-sm font-medium ${
          deafened
            ? "border-red-700 bg-red-950/60 text-red-200"
            : "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
        }`}
      >
        {deafened ? "Undeafen" : "Deafen"}
      </button>
      <button
        onClick={onLeave}
        className="rounded-md border border-red-800 bg-red-900/40 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/70"
      >
        Leave
      </button>
    </div>
  );
}
