/**
 * Voice room session management on top of livekit-client.
 *
 * Design notes:
 * - The microphone is NEVER published before an intentional join.
 * - Deafen implies mute (you cannot accidentally transmit while deafened);
 *   undeafening does not auto-unmute.
 * - LiveKit handles reconnection; we surface its states honestly
 *   (connecting / connected / reconnecting / disconnected).
 * - Remote audio elements live in a hidden container owned by this hook so
 *   deafen and per-participant volume apply to late-joining tracks too.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import type { Participant, RemoteTrack } from "livekit-client";

import { api } from "../api/client";
import { CONNECT_FAILED, describeMediaError, describeTokenError } from "./errors";
import type { VoiceErrorInfo } from "./errors";

export type VoiceStatus =
  | "idle"
  | "requesting-token"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface VoiceParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
}

export interface UseVoiceRoom {
  status: VoiceStatus;
  error: VoiceErrorInfo | null;
  roomName: string | null;
  participants: VoiceParticipant[];
  muted: boolean;
  deafened: boolean;
  join: (micDeviceId?: string, outputDeviceId?: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  setParticipantVolume: (identity: string, volume: number) => void;
  getParticipantVolume: (identity: string) => number;
  switchMicDevice: (deviceId: string) => Promise<void>;
  switchOutputDevice: (deviceId: string) => Promise<void>;
  audioContainerRef: (el: HTMLDivElement | null) => void;
}

export function useVoiceRoom(sessionToken: string): UseVoiceRoom {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<VoiceErrorInfo | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafenedState] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const deafenedRef = useRef(false);
  const intentionalLeaveRef = useRef(false);
  const volumesRef = useRef<Map<string, number>>(new Map());
  const audioElsRef = useRef<HTMLDivElement | null>(null);

  const audioContainerRef = useCallback((el: HTMLDivElement | null) => {
    audioElsRef.current = el;
  }, []);

  const syncParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipants([]);
      return;
    }
    const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
    const toEntry = (p: Participant, isLocal: boolean): VoiceParticipant => ({
      identity: p.identity,
      name: p.name && p.name.length > 0 ? p.name : p.identity,
      isLocal,
      speaking: speaking.has(p.identity),
      micMuted: !p.isMicrophoneEnabled,
    });
    const list = [toEntry(room.localParticipant, true)];
    for (const p of room.remoteParticipants.values()) list.push(toEntry(p, false));
    setParticipants(list);
    setMuted(!room.localParticipant.isMicrophoneEnabled);
  }, []);

  const applyVolume = useCallback((track: RemoteTrack, identity: string) => {
    if (track instanceof RemoteAudioTrack) {
      const base = volumesRef.current.get(identity) ?? 1;
      track.setVolume(deafenedRef.current ? 0 : base);
    }
  }, []);

  const applyAllVolumes = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.kind === Track.Kind.Audio) {
          applyVolume(pub.track as RemoteTrack, p.identity);
        }
      }
    }
  }, [applyVolume]);

  const cleanupRoom = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) room.removeAllListeners();
    if (audioElsRef.current) audioElsRef.current.replaceChildren();
    setParticipants([]);
    setRoomName(null);
  }, []);

  const join = useCallback(
    async (micDeviceId?: string, outputDeviceId?: string) => {
      if (roomRef.current) return; // already joined/joining
      setError(null);
      setStatus("requesting-token");

      let grant: { token: string; ws_url: string; room: string };
      try {
        const { data, error: apiError } = await api.POST("/api/v1/dev/voice-token", {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (apiError || !data) {
          setError(describeTokenError((apiError as { code?: string } | null)?.code));
          setStatus("idle");
          return;
        }
        grant = data;
      } catch {
        setError({
          code: "api_unreachable",
          message: "Could not reach the server to authorize the voice connection.",
        });
        setStatus("idle");
        return;
      }

      const room = new Room({
        // exact: a bare deviceId is only a preference and the browser may
        // substitute a different device (e.g. a vendor's virtual mic).
        audioCaptureDefaults: micDeviceId ? { deviceId: { exact: micDeviceId } } : undefined,
        audioOutput: outputDeviceId ? { deviceId: outputDeviceId } : undefined,
      });
      roomRef.current = room;
      intentionalLeaveRef.current = false;

      room
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Reconnecting) setStatus("reconnecting");
          else if (state === ConnectionState.Connected) setStatus("connected");
        })
        .on(RoomEvent.Disconnected, () => {
          cleanupRoom();
          setStatus(intentionalLeaveRef.current ? "idle" : "disconnected");
        })
        .on(RoomEvent.ParticipantConnected, syncParticipants)
        .on(RoomEvent.ParticipantDisconnected, syncParticipants)
        .on(RoomEvent.ActiveSpeakersChanged, syncParticipants)
        .on(RoomEvent.TrackMuted, syncParticipants)
        .on(RoomEvent.TrackUnmuted, syncParticipants)
        .on(RoomEvent.LocalTrackPublished, syncParticipants)
        .on(RoomEvent.LocalTrackUnpublished, syncParticipants)
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            audioElsRef.current?.appendChild(el);
            applyVolume(track, participant.identity);
          }
          syncParticipants();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((el) => el.remove());
          syncParticipants();
        });

      setStatus("connecting");
      // Diagnostic flag (?forceRelay=1): restrict ICE to relay candidates so
      // the TURN path can be validated end-to-end. Harmless in normal use.
      const forceRelay = new URLSearchParams(window.location.search).has("forceRelay");
      try {
        await room.connect(
          grant.ws_url,
          grant.token,
          forceRelay ? { rtcConfig: { iceTransportPolicy: "relay" } } : undefined,
        );
      } catch {
        cleanupRoom();
        setError(CONNECT_FAILED);
        setStatus("idle");
        return;
      }
      setRoomName(grant.room);

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        // Connected but cannot transmit — stay in the room, surface the cause.
        setError(describeMediaError(e));
      }
      setStatus("connected");
      syncParticipants();
    },
    [applyVolume, cleanupRoom, sessionToken, syncParticipants],
  );

  const leave = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    intentionalLeaveRef.current = true;
    await room.disconnect();
    // Disconnected event performs cleanup; make state deterministic anyway.
    cleanupRoom();
    setStatus("idle");
    setDeafenedState(false);
    deafenedRef.current = false;
  }, [cleanupRoom]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const enable = !room.localParticipant.isMicrophoneEnabled;
    if (enable && deafenedRef.current) {
      // Unmuting while deafened undeafens — you should hear who you talk to.
      deafenedRef.current = false;
      setDeafenedState(false);
      applyAllVolumes();
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(enable);
      setError(null);
    } catch (e) {
      setError(describeMediaError(e));
    }
    syncParticipants();
  }, [applyAllVolumes, syncParticipants]);

  const toggleDeafen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setDeafenedState(next);
    applyAllVolumes();
    if (next && room.localParticipant.isMicrophoneEnabled) {
      // Deafen implies mute: never transmit while unable to hear others.
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (e) {
        setError(describeMediaError(e));
      }
    }
    syncParticipants();
  }, [applyAllVolumes, syncParticipants]);

  const setParticipantVolume = useCallback(
    (identity: string, volume: number) => {
      volumesRef.current.set(identity, volume);
      if (!deafenedRef.current) applyAllVolumes();
    },
    [applyAllVolumes],
  );

  const getParticipantVolume = useCallback(
    (identity: string) => volumesRef.current.get(identity) ?? 1,
    [],
  );

  const switchMicDevice = useCallback(async (deviceId: string) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      // exact=true: a bare deviceId is only a preference and the browser may
      // silently keep capturing a different device (e.g. a virtual one).
      await room.switchActiveDevice("audioinput", deviceId, true);
    } catch (e) {
      setError(describeMediaError(e));
    }
  }, []);

  const switchOutputDevice = useCallback(async (deviceId: string) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice("audiooutput", deviceId, true);
    } catch {
      setError({
        code: "output_switch_failed",
        message: "Could not switch the output device (your browser may not support it).",
      });
    }
  }, []);

  // Leave the room if the component unmounts (e.g. sign-out mid-call).
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      if (room) {
        intentionalLeaveRef.current = true;
        void room.disconnect();
        room.removeAllListeners();
        roomRef.current = null;
      }
    };
  }, []);

  return {
    status,
    error,
    roomName,
    participants,
    muted,
    deafened,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    setParticipantVolume,
    getParticipantVolume,
    switchMicDevice,
    switchOutputDevice,
    audioContainerRef,
  };
}
