import { useState } from "react";

import type { ChannelInfo } from "../queries";
import type { UseVoiceRoom } from "../voice/useVoiceRoom";
import { ConnectionBanner } from "./ConnectionBanner";
import { DeviceSelectors } from "./DeviceSelectors";
import { MicTest } from "./MicTest";
import { OutputTest } from "./OutputTest";
import { ParticipantList } from "./ParticipantList";
import { VoiceControls } from "./VoiceControls";

interface VoiceWorkspaceProps {
  channel: ChannelInfo;
  voice: UseVoiceRoom;
  mics: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  selectedMic: string;
  selectedOutput: string;
  onMicChange: (id: string) => void;
  onOutputChange: (id: string) => void;
  onPermissionGranted: () => void;
}

export function VoiceWorkspace({
  channel,
  voice,
  mics,
  outputs,
  selectedMic,
  selectedOutput,
  onMicChange,
  onOutputChange,
  onPermissionGranted,
}: VoiceWorkspaceProps) {
  const [passphrase, setPassphrase] = useState("");
  const inThisChannel = voice.channel?.id === channel.id;
  const inRoomHere =
    inThisChannel && (voice.status === "connected" || voice.status === "reconnecting");
  const busyElsewhere = voice.channel !== null && !inThisChannel && voice.status !== "idle";
  const canConnect = channel.capabilities.includes("CONNECT_VOICE");
  const e2eeHere = inThisChannel && voice.e2eeActive;
  const someoneUnencrypted =
    e2eeHere && voice.participants.some((p) => !p.isLocal && !p.encrypted);

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-base font-semibold">
        {e2eeHere ? "🔐" : "🔊"} {channel.name}
      </h2>

      {/* Honest encryption state for THIS call (ADR-0006). */}
      {e2eeHere && !someoneUnencrypted && (
        <div
          role="note"
          aria-label="Call encryption status"
          className="rounded-md border border-emerald-700/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200"
        >
          <p className="font-medium">End-to-end encrypted (passphrase).</p>
          <p className="mt-1 text-emerald-200/80">
            Audio is encrypted in your browser before it leaves — this server and its operator
            cannot access it. Everyone must enter the same passphrase (shared outside this app);
            anyone with the passphrase and channel access can listen. Removing someone does NOT
            change the key — agree on a new passphrase to lock them out of future calls.
          </p>
        </div>
      )}
      {e2eeHere && someoneUnencrypted && (
        <div
          role="alert"
          aria-label="Call encryption status"
          className="rounded-md border border-amber-600/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-200"
        >
          <p className="font-medium">Encryption degraded.</p>
          <p className="mt-1 text-amber-200/80">
            Some participants are not sending end-to-end encrypted audio. Their audio is only
            transport-encrypted, and they cannot hear encrypted participants.
          </p>
        </div>
      )}
      {inRoomHere && !e2eeHere && (
        <p
          role="note"
          aria-label="Call encryption status"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-400"
        >
          Transport encryption only — not end-to-end encrypted. Leave and rejoin with a passphrase
          (below) to encrypt this call end-to-end.
        </p>
      )}

      <ConnectionBanner
        status={inThisChannel ? voice.status : "idle"}
        error={inThisChannel ? voice.error : null}
      />

      {busyElsewhere && (
        <p className="rounded-md border border-amber-600/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          You are connected to {voice.channel?.name}. Leave that channel to join this one.
        </p>
      )}

      {!canConnect && (
        <p className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-400">
          You don't have permission to join this voice channel.
        </p>
      )}

      <DeviceSelectors
        mics={mics}
        outputs={outputs}
        selectedMic={selectedMic}
        selectedOutput={selectedOutput}
        onMicChange={onMicChange}
        onOutputChange={onOutputChange}
      />

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        {!inRoomHere && (
          <MicTest
            deviceId={selectedMic}
            outputDeviceId={selectedOutput}
            onPermissionGranted={onPermissionGranted}
          />
        )}
        <OutputTest outputDeviceId={selectedOutput} />
      </div>

      {canConnect && !busyElsewhere && !inRoomHere && voice.status === "idle" && (
        <div className="max-w-md">
          <label
            htmlFor="e2ee-passphrase"
            className="block text-sm font-medium text-slate-300"
          >
            Voice encryption passphrase (optional)
          </label>
          <input
            id="e2ee-passphrase"
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-400">
            With a passphrase, audio is end-to-end encrypted — the server cannot access it.
            Everyone must enter the exact same passphrase (share it outside this app) or they
            will hear silence. Without one, the call uses transport encryption only.
          </p>
        </div>
      )}

      {canConnect && !busyElsewhere && (
        <VoiceControls
          status={inThisChannel ? voice.status : "idle"}
          muted={voice.muted}
          deafened={voice.deafened}
          onJoin={() =>
            void voice.join(
              { id: channel.id, name: channel.name },
              selectedMic || undefined,
              selectedOutput || undefined,
              passphrase.trim() || undefined,
            )
          }
          onLeave={() => void voice.leave()}
          onToggleMute={() => void voice.toggleMute()}
          onToggleDeafen={() => void voice.toggleDeafen()}
        />
      )}

      {inThisChannel && (
        <ParticipantList
          participants={voice.participants}
          getVolume={voice.getParticipantVolume}
          onVolumeChange={voice.setParticipantVolume}
          showEncryption={voice.e2eeActive}
        />
      )}
    </section>
  );
}
