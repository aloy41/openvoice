/**
 * Three-pane community workspace: community rail, channel sidebar, and the
 * active content pane (voice workspace / placeholders). The voice session is
 * owned here so an active call survives navigating between channels and
 * communities.
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Room } from "livekit-client";

import { useCommunities, useCommunityDetail, usePresence } from "../queries";
import type { MessageInfo } from "../queries";
import { useCommunityEvents } from "../realtime";
import type { CommunityEvent, Signal } from "../realtime";
import { useSession } from "../session";
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
  const { user } = useSession();
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);
  // Message passphrase per community, held in memory only (never persisted or
  // sent to the server). Cleared when switching communities.
  const [messagePassphrase, setMessagePassphrase] = useState("");
  // Channels with messages arrived since you last looked at them.
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const detail = useCommunityDetail(selectedCommunityId);

  // Presence (online user ids) — seeded by a query, updated live by signals.
  const presenceQuery = usePresence(selectedCommunityId);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Always count self as online — the presence query can race the WS
    // marking us online, and we never receive our own presence signal.
    const base = new Set(presenceQuery.data ?? []);
    if (user?.id) base.add(user.id);
    setOnlineIds(base);
  }, [presenceQuery.data, user?.id]);

  // Typing: per-channel map of userId → { name, at } (expires client-side).
  const [typing, setTyping] = useState<Record<string, Record<string, { name: string; at: number }>>>(
    {},
  );
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let changed = false;
        const next: typeof prev = {};
        for (const [ch, users] of Object.entries(prev)) {
          const kept: Record<string, { name: string; at: number }> = {};
          for (const [uid, info] of Object.entries(users)) {
            if (now - info.at < 6000) kept[uid] = info;
            else changed = true;
          }
          if (Object.keys(kept).length > 0) next[ch] = kept;
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const onSignal = useCallback(
    (signal: Signal) => {
      if (signal.type === "presence") {
        if (signal.user_id === user?.id) return; // never mark self offline
        setOnlineIds((prev) => {
          const next = new Set(prev);
          if (signal.online) next.add(signal.user_id);
          else next.delete(signal.user_id);
          return next;
        });
      } else if (signal.type === "typing" && signal.channel_id) {
        if (signal.user_id === user?.id) return; // ignore self
        setTyping((prev) => ({
          ...prev,
          [signal.channel_id!]: {
            ...(prev[signal.channel_id!] ?? {}),
            [signal.user_id]: { name: signal.display_name ?? "Someone", at: Date.now() },
          },
        }));
      }
    },
    [user?.id],
  );

  // Live events for the selected community: keep the message caches fresh.
  const { sendTyping } = useCommunityEvents(
    selectedCommunityId,
    useCallback(
      (event: CommunityEvent) => {
        if (event.type.startsWith("membership.")) {
          void queryClient.invalidateQueries({ queryKey: ["members", event.community_id] });
          void queryClient.invalidateQueries({ queryKey: ["bans", event.community_id] });
        }
        if (event.type === "community.updated") {
          void queryClient.invalidateQueries({ queryKey: ["community", event.community_id] });
          void queryClient.invalidateQueries({ queryKey: ["communities"] });
        }
        if (event.type === "message.created" || event.type === "message.updated") {
          const message = event.payload.message as MessageInfo;
          // Mark another channel unread when a new message lands there.
          if (event.type === "message.created" && message.channel_id !== selectedChannelId) {
            setUnread((prev) => {
              if (prev.has(message.channel_id)) return prev;
              const next = new Set(prev);
              next.add(message.channel_id);
              return next;
            });
          }
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
      [queryClient, selectedChannelId],
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
    onSignal,
  );

  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedOutput, setSelectedOutput] = useState("");

  // Browsers hide device labels (and often the devices themselves) until the
  // page has been granted microphone access. `prompt` asks LiveKit to call
  // getUserMedia first so enumeration returns real, labelled devices — used
  // when the voice UI opens, so mics show up without having to run a mic test.
  const refreshDevices = useCallback(async (prompt = false) => {
    try {
      const inputs = await Room.getLocalDevices("audioinput", prompt);
      const outs = await Room.getLocalDevices("audiooutput", false);
      setMics(inputs);
      setOutputs(outs);
      setSelectedMic((cur) =>
        cur && inputs.some((d) => d.deviceId === cur) ? cur : (inputs[0]?.deviceId ?? ""),
      );
      setSelectedOutput((cur) =>
        cur && outs.some((d) => d.deviceId === cur) ? cur : (outs[0]?.deviceId ?? ""),
      );
    } catch {
      // Permission denied or enumeration unsupported — selectors stay empty
      // and the mic test / join flow can still request access later.
    }
  }, []);

  // Stable so the voice workspace's mount effect doesn't re-prompt each render.
  const primeDevices = useCallback(() => void refreshDevices(true), [refreshDevices]);

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
            onSelectChannel={(id) => {
              setSelectedChannelId(id);
              setUnread((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }}
            unread={unread}
            voice={voice}
            onCommunityGone={() => selectCommunity(null)}
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
                    typingNames={Object.values(typing[selectedChannel.id] ?? {}).map(
                      (t) => t.name,
                    )}
                    onTyping={() => sendTyping(selectedChannel.id)}
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
                  primeDevices={primeDevices}
                />
              )}
            </div>
          </main>
          {detail.data && <MembersPanel detail={detail.data} onlineIds={onlineIds} />}
        </>
      )}
      {/* Remote audio elements render here, hidden; owned by the voice hook. */}
      <div ref={voice.audioContainerRef} className="hidden" aria-hidden />
    </div>
  );
}
