import { useCallback, useEffect, useRef, useState } from "react";

import { describeMediaError } from "../voice/errors";

/** Pre-join microphone test: captures the selected input locally (nothing is
 * transmitted) and shows a live input level meter. */
export function MicTest({ deviceId, onPermissionGranted }: { deviceId: string; onPermissionGranted?: () => void }) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      onPermissionGranted?.();
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const centered = (v - 128) / 128;
          sum += centered * centered;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setTesting(true);
    } catch (e) {
      setError(describeMediaError(e).message);
      stop();
    }
  }, [deviceId, onPermissionGranted, stop]);

  useEffect(() => stop, [stop]); // release the mic on unmount

  // Restart on device change while testing.
  useEffect(() => {
    if (testing) {
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <button
          onClick={testing ? stop : start}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
        >
          {testing ? "Stop mic test" : "Test microphone"}
        </button>
        <div
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          className="h-2 w-40 overflow-hidden rounded bg-slate-800"
        >
          <div
            className="h-full bg-emerald-500 transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
