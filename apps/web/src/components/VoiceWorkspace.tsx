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
  const inThisChannel = voice.channel?.id === channel.id;
  const inRoomHere =
    inThisChannel && (voice.status === "connected" || voice.status === "reconnecting");
  const busyElsewhere = voice.channel !== null && !inThisChannel && voice.status !== "idle";
  const canConnect = channel.capabilities.includes("CONNECT_VOICE");

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-base font-semibold">🔊 {channel.name}</h2>

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
        />
      )}
    </section>
  );
}
