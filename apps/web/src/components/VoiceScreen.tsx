import { useCallback, useEffect, useState } from "react";
import { Room } from "livekit-client";

import type { Session } from "../session";
import { useVoiceRoom } from "../voice/useVoiceRoom";
import { ConnectionBanner } from "./ConnectionBanner";
import { DeviceSelectors } from "./DeviceSelectors";
import { EncryptionNotice } from "./EncryptionNotice";
import { MicTest } from "./MicTest";
import { OutputTest } from "./OutputTest";
import { ParticipantList } from "./ParticipantList";
import { VoiceControls } from "./VoiceControls";

export function VoiceScreen({ session }: { session: Session }) {
  const voice = useVoiceRoom(session.token);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedOutput, setSelectedOutput] = useState("");

  const refreshDevices = useCallback(async () => {
    try {
      const [inputs, outs] = await Promise.all([
        Room.getLocalDevices("audioinput", false),
        Room.getLocalDevices("audiooutput", false),
      ]);
      setMics(inputs);
      setOutputs(outs);
      setSelectedMic((cur) =>
        cur && inputs.some((d) => d.deviceId === cur) ? cur : (inputs[0]?.deviceId ?? ""),
      );
      setSelectedOutput((cur) =>
        cur && outs.some((d) => d.deviceId === cur) ? cur : (outs[0]?.deviceId ?? ""),
      );
    } catch {
      // Device enumeration unsupported — selectors stay empty; join still works.
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [refreshDevices]);

  const inRoom = voice.status === "connected" || voice.status === "reconnecting";

  return (
    <div className="space-y-6">
      <EncryptionNotice />

      <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">
            {inRoom && voice.roomName ? `Voice room: ${voice.roomName}` : "Development voice room"}
          </h2>
        </div>

        <ConnectionBanner status={voice.status} error={voice.error} />

        <DeviceSelectors
          mics={mics}
          outputs={outputs}
          selectedMic={selectedMic}
          selectedOutput={selectedOutput}
          onMicChange={(id) => {
            setSelectedMic(id);
            void voice.switchMicDevice(id); // no-op when not in a room
          }}
          onOutputChange={(id) => {
            setSelectedOutput(id);
            void voice.switchOutputDevice(id); // no-op when not in a room
          }}
        />

        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          {!inRoom && (
            <MicTest
              deviceId={selectedMic}
              outputDeviceId={selectedOutput}
              onPermissionGranted={refreshDevices}
            />
          )}
          <OutputTest outputDeviceId={selectedOutput} />
        </div>

        <VoiceControls
          status={voice.status}
          muted={voice.muted}
          deafened={voice.deafened}
          onJoin={() => void voice.join(selectedMic || undefined, selectedOutput || undefined)}
          onLeave={() => void voice.leave()}
          onToggleMute={() => void voice.toggleMute()}
          onToggleDeafen={() => void voice.toggleDeafen()}
        />

        <ParticipantList
          participants={voice.participants}
          getVolume={voice.getParticipantVolume}
          onVolumeChange={voice.setParticipantVolume}
        />
      </section>

      {/* Remote audio elements render here, hidden; owned by the voice hook. */}
      <div ref={voice.audioContainerRef} className="hidden" aria-hidden />
    </div>
  );
}
