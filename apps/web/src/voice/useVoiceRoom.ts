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
  ExternalE2EEKeyProvider,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import type { Participant, RemoteTrack, RoomOptions } from "livekit-client";

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
  /** Frame-encryption state; only meaningful while E2EE is active. */
  encrypted: boolean;
}

export interface VoiceChannelRef {
  id: string;
  name: string;
}

export interface UseVoiceRoom {
  status: VoiceStatus;
  error: VoiceErrorInfo | null;
  /** The channel currently joined (or being joined). */
  channel: VoiceChannelRef | null;
  /** True when this call uses passphrase E2EE (ADR-0006). */
  e2eeActive: boolean;
  participants: VoiceParticipant[];
  muted: boolean;
  deafened: boolean;
  join: (
    channel: VoiceChannelRef,
    micDeviceId?: string,
    outputDeviceId?: string,
    e2eePassphrase?: string,
  ) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  setParticipantVolume: (identity: string, volume: number) => void;
  getParticipantVolume: (identity: string) => number;
  switchMicDevice: (deviceId: string) => Promise<void>;
  switchOutputDevice: (deviceId: string) => Promise<void>;
  audioContainerRef: (el: HTMLDivElement | null) => void;
}

export function useVoiceRoom(): UseVoiceRoom {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<VoiceErrorInfo | null>(null);
  const [channel, setChannel] = useState<VoiceChannelRef | null>(null);
  const [e2eeActive, setE2eeActive] = useState(false);
  const e2eeWorkerRef = useRef<Worker | null>(null);
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
      encrypted: p.isEncrypted,
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
    e2eeWorkerRef.current?.terminate();
    e2eeWorkerRef.current = null;
    setParticipants([]);
    setChannel(null);
    setE2eeActive(false);
  }, []);

  const join = useCallback(
    async (
      target: VoiceChannelRef,
      micDeviceId?: string,
      outputDeviceId?: string,
      e2eePassphrase?: string,
    ) => {
      if (roomRef.current) return; // already joined/joining
      setError(null);
      setStatus("requesting-token");
      setChannel(target);

      let grant: { token: string; ws_url: string; room: string };
      try {
        // Authenticated by the session cookie; CSRF header added by the
        // client middleware. Authorization (membership + CONNECT_VOICE on
        // this channel) happens server-side.
        const { data, error: apiError } = await api.POST(
          "/api/v1/channels/{channel_id}/voice-token",
          { params: { path: { channel_id: target.id } } },
        );
        if (apiError || !data) {
          setError(describeTokenError((apiError as { code?: string } | null)?.code));
          setStatus("idle");
          setChannel(null);
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

      const roomOptions: RoomOptions = {
        // exact: a bare deviceId is only a preference and the browser may
        // substitute a different device (e.g. a vendor's virtual mic).
        audioCaptureDefaults: micDeviceId ? { deviceId: { exact: micDeviceId } } : undefined,
        audioOutput: outputDeviceId ? { deviceId: outputDeviceId } : undefined,
      };
      // Passphrase E2EE (ADR-0006): the key is derived client-side (PBKDF2
      // inside LiveKit's audited SDK) and NEVER leaves this browser — the
      // API has no code path that can receive key material.
      let keyProvider: ExternalE2EEKeyProvider | null = null;
      if (e2eePassphrase) {
        keyProvider = new ExternalE2EEKeyProvider();
        const worker = new Worker(
          new URL("livekit-client/e2ee-worker", import.meta.url),
          { type: "module" },
        );
        e2eeWorkerRef.current = worker;
        roomOptions.e2ee = { keyProvider, worker };
      }
      const room = new Room(roomOptions);
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
        })
        .on(RoomEvent.ParticipantEncryptionStatusChanged, syncParticipants);

      if (keyProvider && e2eePassphrase) {
        try {
          await keyProvider.setKey(e2eePassphrase);
          await room.setE2EEEnabled(true);
          setE2eeActive(true);
        } catch {
          cleanupRoom();
          setError({
            code: "e2ee_unavailable",
            message:
              "End-to-end encryption could not be enabled in this browser (insertable streams unsupported). The call was NOT started without encryption.",
          });
          setStatus("idle");
          return;
        }
      }

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

      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        // Connected but cannot transmit — stay in the room, surface the cause.
        setError(describeMediaError(e));
      }
      setStatus("connected");
      syncParticipants();
    },
    [applyVolume, cleanupRoom, syncParticipants],
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
    channel,
    e2eeActive,
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
