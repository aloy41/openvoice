import { useCallback, useEffect, useRef, useState } from "react";

import { describeMediaError } from "../voice/errors";

interface MicTestProps {
  deviceId: string;
  outputDeviceId: string;
  onPermissionGranted?: () => void;
}

/**
 * Pre-join microphone test: captures the selected input locally (nothing is
 * transmitted) and shows a live input level meter. Optionally monitors the
 * mic back to the selected output ("hear myself") — with an echo warning,
 * since that loops audio to speakers.
 *
 * Diagnostics: while testing we show which device the browser actually
 * captured (it can differ from the dropdown), surface the OS-level muted
 * flag, and warn with actionable causes if the capture stays silent.
 *
 * Changing the input device while testing restarts the capture with the new
 * device. Restarts are guarded by the actually-captured device id so
 * re-renders can never trigger a restart loop (which previously killed each
 * capture before the meter accumulated data).
 */
export function MicTest({ deviceId, outputDeviceId, onPermissionGranted }: MicTestProps) {
  const [testing, setTesting] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [captureLabel, setCaptureLabel] = useState<string | null>(null);
  const [osMuted, setOsMuted] = useState(false);
  const [silentHint, setSilentHint] = useState(false);

  const testingRef = useRef(false);
  const activeDevRef = useRef<string | null>(null);
  const monitoringRef = useRef(false);
  const outputIdRef = useRef(outputDeviceId);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const peakRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitorElRef = useRef<HTMLAudioElement | null>(null);

  const detachMonitor = useCallback(() => {
    const el = monitorElRef.current;
    if (el) {
      el.pause();
      el.srcObject = null;
    }
  }, []);

  const attachMonitor = useCallback(async () => {
    const el = monitorElRef.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    const sinkId = outputIdRef.current;
    if (sinkId && typeof el.setSinkId === "function") {
      await el.setSinkId(sinkId).catch(() => undefined);
    }
    await el.play().catch(() => undefined);
  }, []);

  const releaseCapture = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    detachMonitor();
    streamRef.current?.getTracks().forEach((t) => {
      t.onmute = null;
      t.onunmute = null;
      t.stop();
    });
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
  }, [detachMonitor]);

  const stop = useCallback(() => {
    releaseCapture();
    testingRef.current = false;
    activeDevRef.current = null;
    setTesting(false);
    setLevel(0);
    setCaptureLabel(null);
    setOsMuted(false);
    setSilentHint(false);
  }, [releaseCapture]);

  const start = useCallback(
    async (dev: string) => {
      setError(null);
      setSilentHint(false);
      releaseCapture();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: dev ? { deviceId: dev } : true,
        });
      } catch (e) {
        stop();
        setError(describeMediaError(e).message);
        return;
      }
      streamRef.current = stream;
      testingRef.current = true;
      activeDevRef.current = dev;
      setTesting(true);
      onPermissionGranted?.();

      const track = stream.getAudioTracks()[0];
      setCaptureLabel(track?.label ?? null);
      setOsMuted(track?.muted ?? false);
      if (track) {
        track.onmute = () => setOsMuted(true);
        track.onunmute = () => setOsMuted(false);
      }

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      // Chrome may create the context suspended when the permission prompt
      // consumed the user activation; a suspended context reads pure silence.
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      peakRef.current = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) {
          const centered = (v - 128) / 128;
          sum += centered * centered;
        }
        const value = Math.min(1, Math.sqrt(sum / data.length) * 3);
        if (value > peakRef.current) peakRef.current = value;
        setLevel(value);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      silenceTimerRef.current = setTimeout(() => {
        if (testingRef.current && peakRef.current < 0.02) setSilentHint(true);
      }, 3000);
      if (monitoringRef.current) await attachMonitor();
    },
    [attachMonitor, onPermissionGranted, releaseCapture, stop],
  );

  // Restart (not stop) when the selected input changes mid-test. Guarded by
  // the actually-captured device so re-renders can never trigger a restart
  // loop that kills each capture before the meter accumulates data.
  useEffect(() => {
    if (testingRef.current && activeDevRef.current !== deviceId) void start(deviceId);
  }, [deviceId, start]);

  // Live-switch the monitor output when the selected output changes.
  useEffect(() => {
    outputIdRef.current = outputDeviceId;
    const el = monitorElRef.current;
    if (el && el.srcObject && outputDeviceId && typeof el.setSinkId === "function") {
      void el.setSinkId(outputDeviceId).catch(() => undefined);
    }
  }, [outputDeviceId]);

  useEffect(() => stop, [stop]); // release the mic on unmount

  async function toggleMonitor() {
    const next = !monitoring;
    setMonitoring(next);
    monitoringRef.current = next;
    if (testingRef.current) {
      if (next) await attachMonitor();
      else detachMonitor();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={testing ? stop : () => void start(deviceId)}
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
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={monitoring} onChange={() => void toggleMonitor()} />
          Hear myself
        </label>
      </div>
      {testing && captureLabel !== null && (
        <p data-testid="capture-info" className="text-xs text-slate-400">
          Capturing: {captureLabel === "" ? "(unnamed device)" : captureLabel}
        </p>
      )}
      {testing && osMuted && (
        <p role="alert" className="text-sm text-amber-300">
          Windows reports this microphone as muted. Check the hardware mute switch/key and the
          Windows sound settings for this device.
        </p>
      )}
      {testing && silentHint && !osMuted && (
        <p role="alert" className="text-sm text-amber-300">
          No sound is arriving from this device. Try: pick a different microphone in the list
          above; check Windows Settings → Privacy &amp; security → Microphone (both the global
          toggle and browser access); check the device's input volume in Windows sound
          settings; and make sure no hardware mute is on. The meter will move as soon as audio
          arrives.
        </p>
      )}
      {monitoring && (
        <p className="text-xs text-amber-300/90">
          Your microphone is playing back to your output device. Use headphones to avoid
          echo/feedback from speakers.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {/* Hidden element that plays the mic back when monitoring is on. */}
      <audio ref={monitorElRef} className="hidden" aria-hidden />
    </div>
  );
}
