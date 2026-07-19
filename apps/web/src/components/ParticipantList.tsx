import type { VoiceParticipant } from "../voice/useVoiceRoom";

export interface ParticipantListProps {
  participants: VoiceParticipant[];
  getVolume: (identity: string) => number;
  onVolumeChange: (identity: string, volume: number) => void;
  /** Show per-participant frame-encryption state (E2EE calls only). */
  showEncryption?: boolean;
}

export function ParticipantList({
  participants,
  getVolume,
  onVolumeChange,
  showEncryption = false,
}: ParticipantListProps) {
  if (participants.length === 0) return null;
  return (
    <ul aria-label="Participants" className="space-y-2">
      {participants.map((p) => (
        <li
          key={p.identity}
          className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900 px-3 py-2"
        >
          <span
            aria-hidden
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              p.speaking ? "bg-emerald-400 motion-safe:animate-pulse" : "bg-slate-600"
            }`}
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {p.name}
            {p.isLocal && <span className="text-slate-400"> (you)</span>}
          </span>
          {p.speaking && <span className="sr-only">speaking</span>}
          {showEncryption &&
            (p.encrypted ? (
              <span title="Sending end-to-end encrypted audio" aria-label="encrypted">
                🔐
              </span>
            ) : (
              <span
                className="rounded bg-amber-950/60 px-1.5 py-0.5 text-xs text-amber-300"
                aria-label="not encrypted"
              >
                not encrypted
              </span>
            ))}
          {p.micMuted && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
              muted
            </span>
          )}
          {!p.isLocal && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                defaultValue={getVolume(p.identity)}
                onChange={(e) => onVolumeChange(p.identity, Number(e.target.value))}
                aria-label={`Volume for ${p.name}`}
              />
            </label>
          )}
        </li>
      ))}
    </ul>
  );
}
