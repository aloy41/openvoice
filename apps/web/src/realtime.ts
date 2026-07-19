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
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

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
        let msg: { type?: string; seq?: number } & CommunityEvent;
        try {
          msg = JSON.parse(String(raw.data));
        } catch {
          return;
        }
        if (msg.type === "event" || (msg.seq !== undefined && msg.community_id)) {
          const event = msg as CommunityEvent;
          if (event.seq <= lastSeq) return; // replay overlap — already seen
          lastSeq = event.seq;
          handlerRef.current(event);
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
