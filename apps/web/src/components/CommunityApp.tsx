/**
 * Three-pane community workspace: community rail, channel sidebar, and the
 * active content pane (voice workspace / placeholders). The voice session is
 * owned here so an active call survives navigating between channels and
 * communities.
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Room } from "livekit-client";

import { useCommunities, useCommunityDetail } from "../queries";
import type { MessageInfo } from "../queries";
import { useCommunityEvents } from "../realtime";
import type { CommunityEvent } from "../realtime";
import { useVoiceRoom } from "../voice/useVoiceRoom";
import { ChannelSidebar } from "./ChannelSidebar";
import { CommunityRail } from "./CommunityRail";
import { HomePane } from "./HomePane";
import { MembersPanel } from "./MembersPanel";
import { TextChannelView } from "./TextChannelView";
import { VoiceWorkspace } from "./VoiceWorkspace";

export function CommunityApp() {
  const voice = useVoiceRoom();
  const communities = useCommunities();
  const queryClient = useQueryClient();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  // Message passphrase per community, held in memory only (never persisted or
  // sent to the server). Cleared when switching communities.
  const [messagePassphrase, setMessagePassphrase] = useState("");
  const detail = useCommunityDetail(selectedCommunityId);

  // Live events for the selected community: keep the message caches fresh.
  useCommunityEvents(
    selectedCommunityId,
    useCallback(
      (event: CommunityEvent) => {
        if (event.type.startsWith("membership.")) {
          void queryClient.invalidateQueries({ queryKey: ["members", event.community_id] });
          void queryClient.invalidateQueries({ queryKey: ["bans", event.community_id] });
        }
        if (event.type === "message.created" || event.type === "message.updated") {
          const message = event.payload.message as MessageInfo;
          queryClient.setQueryData<MessageInfo[]>(
            ["messages", message.channel_id],
            (old) => {
              if (!old) return old;
              const existing = old.findIndex((m) => m.id === message.id);
              if (existing >= 0) {
                const next = [...old];
                // Preserve reactions — edit events don't carry them.
                next[existing] = { ...message, reactions: old[existing]!.reactions };
                return next;
              }
              return [...old, message];
            },
          );
        } else if (event.type === "message.deleted") {
          const channelId = event.payload.channel_id as string;
          const messageId = event.payload.message_id as string;
          queryClient.setQueryData<MessageInfo[]>(["messages", channelId], (old) =>
            old?.map((m) =>
              m.id === messageId ? { ...m, deleted: true, content: "" } : m,
            ),
          );
        } else if (event.type === "message.reaction_updated") {
          const channelId = event.payload.channel_id as string;
          const messageId = event.payload.message_id as string;
          const reactions = event.payload.reactions as MessageInfo["reactions"];
          queryClient.setQueryData<MessageInfo[]>(["messages", channelId], (old) =>
            old?.map((m) => (m.id === messageId ? { ...m, reactions } : m)),
          );
        }
      },
      [queryClient],
    ),
    // Kicked or banned: the server cut the stream — leave, refresh the list,
    // and say why honestly.
    useCallback(
      (communityId: string) => {
        setSelectedCommunityId((cur) => (cur === communityId ? null : cur));
        setSelectedChannelId(null);
        setRemovedNotice("You were removed from that community.");
        void queryClient.invalidateQueries({ queryKey: ["communities"] });
      },
      [queryClient],
    ),
  );

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
    setMessagePassphrase("");
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
          {removedNotice && (
            <p
              role="alert"
              className="mx-auto mb-4 max-w-md rounded-md border border-amber-600/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
            >
              {removedNotice}
            </p>
          )}
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
              {selectedChannel === null && (
                <p className="text-sm text-slate-400">
                  Pick a channel from the sidebar.
                </p>
              )}
              {selectedChannel?.kind === "text" && (
                <div className="h-[calc(100vh-14rem)] min-h-64">
                  <TextChannelView
                    channel={selectedChannel}
                    passphrase={messagePassphrase}
                    onPassphraseChange={setMessagePassphrase}
                  />
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
          {detail.data && <MembersPanel detail={detail.data} />}
        </>
      )}
      {/* Remote audio elements render here, hidden; owned by the voice hook. */}
      <div ref={voice.audioContainerRef} className="hidden" aria-hidden />
    </div>
  );
}
