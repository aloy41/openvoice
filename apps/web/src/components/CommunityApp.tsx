/**
 * Three-pane community workspace: community rail, channel sidebar, and the
 * active content pane (voice workspace / placeholders). The voice session is
 * owned here so an active call survives navigating between channels and
 * communities.
 */
import { useCallback, useEffect, useState } from "react";
import { Room } from "livekit-client";

import { useCommunities, useCommunityDetail } from "../queries";
import { useVoiceRoom } from "../voice/useVoiceRoom";
import { ChannelSidebar } from "./ChannelSidebar";
import { CommunityRail } from "./CommunityRail";
import { EncryptionNotice } from "./EncryptionNotice";
import { HomePane } from "./HomePane";
import { VoiceWorkspace } from "./VoiceWorkspace";

export function CommunityApp() {
  const voice = useVoiceRoom();
  const communities = useCommunities();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const detail = useCommunityDetail(selectedCommunityId);

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

  const selectCommunity = useCallback((id: string | null) => {
    setSelectedCommunityId(id);
    setSelectedChannelId(null);
  }, []);

  const selectedChannel =
    detail.data?.channels.find((c) => c.id === selectedChannelId) ?? null;

  return (
    <div className="flex h-full min-h-0">
      <CommunityRail
        communities={communities.data ?? []}
        selectedId={selectedCommunityId}
        onSelect={selectCommunity}
      />
      {selectedCommunityId === null ? (
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8">
          <HomePane
            onCreated={(id) => selectCommunity(id)}
            onJoined={(id) => selectCommunity(id)}
          />
        </main>
      ) : (
        <>
          <ChannelSidebar
            detail={detail.data ?? null}
            loading={detail.isLoading}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            voice={voice}
          />
          <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-3xl space-y-4">
              <EncryptionNotice />
              {selectedChannel === null && (
                <p className="text-sm text-slate-400">
                  Pick a channel from the sidebar.
                </p>
              )}
              {selectedChannel?.kind === "text" && (
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
                  <h2 className="text-base font-semibold">#{selectedChannel.name}</h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Text chat is not built yet — it arrives with a later update (and it will
                    be end-to-end encrypted when it does). Voice channels work today.
                  </p>
                </div>
              )}
              {selectedChannel?.kind === "voice" && (
                <VoiceWorkspace
                  channel={selectedChannel}
                  voice={voice}
                  mics={mics}
                  outputs={outputs}
                  selectedMic={selectedMic}
                  selectedOutput={selectedOutput}
                  onMicChange={(id) => {
                    setSelectedMic(id);
                    void voice.switchMicDevice(id);
                  }}
                  onOutputChange={(id) => {
                    setSelectedOutput(id);
                    void voice.switchOutputDevice(id);
                  }}
                  onPermissionGranted={refreshDevices}
                />
              )}
            </div>
          </main>
        </>
      )}
      {/* Remote audio elements render here, hidden; owned by the voice hook. */}
      <div ref={voice.audioContainerRef} className="hidden" aria-hidden />
    </div>
  );
}
