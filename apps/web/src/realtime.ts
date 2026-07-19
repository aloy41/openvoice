/**
 * Community event stream over WebSocket with automatic reconnect.
 *
 * On every (re)connect the client subscribes with the last seq it has seen,
 * and the server replays the durable event log from there — missed frames
 * can never be lost, only delayed. Events are deduplicated by seq.
 */
import { useEffect, useRef } from "react";

export interface CommunityEvent {
  v: number;
  seq: number;
  id: string;
  type: string;
  ts: string;
  community_id: string;
  payload: Record<string, unknown>;
}

export function useCommunityEvents(
  communityId: string | null,
  onEvent: (event: CommunityEvent) => void,
  onRemoved?: (communityId: string) => void,
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const removedRef = useRef(onRemoved);
  removedRef.current = onRemoved;

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
      ws.onopen = () => {
        retryDelay = 1000;
        ws?.send(
          JSON.stringify({ type: "subscribe", community_id: communityId, after_seq: lastSeq }),
        );
      };
      ws.onmessage = (raw) => {
        let msg: { type?: string; event?: CommunityEvent; code?: string; community_id?: string };
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
        } else if (msg.type === "unsubscribed" && msg.code === "membership_removed") {
          // This user was kicked or banned: the server cut the stream.
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
      ws?.close();
    };
  }, [communityId]);
}
