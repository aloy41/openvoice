/**
 * Community event stream over WebSocket with automatic reconnect.
 *
 * On every (re)connect the client subscribes with the last seq it has seen,
 * and the server replays the durable event log from there — missed frames
 * can never be lost, only delayed. Events are deduplicated by seq.
 */
import { useCallback, useEffect, useRef } from "react";

export interface CommunityEvent {
  v: number;
  seq: number;
  id: string;
  type: string;
  ts: string;
  community_id: string;
  payload: Record<string, unknown>;
}

export interface Signal {
  type: "presence" | "typing";
  user_id: string;
  online?: boolean;
  display_name?: string;
  channel_id?: string;
}

export interface CommunityRealtime {
  /** Throttled: tell the server the user is typing in a channel. */
  sendTyping: (channelId: string) => void;
}

export function useCommunityEvents(
  communityId: string | null,
  onEvent: (event: CommunityEvent) => void,
  onRemoved?: (communityId: string) => void,
  onSignal?: (signal: Signal) => void,
): CommunityRealtime {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const removedRef = useRef(onRemoved);
  removedRef.current = onRemoved;
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;
  const wsRef = useRef<WebSocket | null>(null);
  const lastTypingRef = useRef(0);

  useEffect(() => {
    if (communityId === null) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let lastSeq = 0;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${scheme}://${window.location.host}/api/v1/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        retryDelay = 1000;
        ws?.send(
          JSON.stringify({ type: "subscribe", community_id: communityId, after_seq: lastSeq }),
        );
      };
      ws.onmessage = (raw) => {
        let msg: {
          type?: string;
          event?: CommunityEvent;
          code?: string;
          community_id?: string;
          [k: string]: unknown;
        };
        try {
          msg = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        if (msg.type === "event" && msg.event) {
          const event = msg.event;
          if (event.seq <= lastSeq) return; // replay overlap — already seen
          lastSeq = event.seq;
          handlerRef.current(event);
        } else if (msg.type === "presence" || msg.type === "typing") {
          signalRef.current?.(msg as unknown as Signal);
        } else if (msg.type === "unsubscribed" && msg.code === "membership_removed") {
          closed = true;
          ws?.close();
          removedRef.current?.(msg.community_id ?? communityId);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15_000);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current = null;
      ws?.close();
    };
  }, [communityId]);

  const sendTyping = useCallback(
    (channelId: string) => {
      const now = Date.now();
      if (now - lastTypingRef.current < 2500) return; // throttle
      lastTypingRef.current = now;
      wsRef.current?.send(
        JSON.stringify({ type: "typing", community_id: communityId, channel_id: channelId }),
      );
    },
    [communityId],
  );

  return { sendTyping };
}
