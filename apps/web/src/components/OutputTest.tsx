import { useState } from "react";

/** Plays a short two-note chime on the selected output device so users can
 * confirm they will actually hear the call. Uses AudioContext.setSinkId where
 * the browser supports it; otherwise the chime plays on the default output. */
export function OutputTest({ outputDeviceId }: { outputDeviceId: string }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function play() {
    setError(null);
    setPlaying(true);
    try {
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      const sinkCapable = ctx as AudioContext & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (outputDeviceId && typeof sinkCapable.setSinkId === "function") {
        await sinkCapable.setSinkId(outputDeviceId);
      }
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.connect(gain);
      const t = ctx.currentTime;
      osc.frequency.setValueAtTime(523.25, t); // C5
      osc.frequency.setValueAtTime(659.25, t + 0.35); // E5
      gain.gain.linearRampToValueAtTime(0.25, t + 0.03);
      gain.gain.setValueAtTime(0.25, t + 0.28);
      gain.gain.linearRampToValueAtTime(0.0001, t + 0.34);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.4);
      gain.gain.setValueAtTime(0.25, t + 0.65);
      gain.gain.linearRampToValueAtTime(0.0001, t + 0.78);
      osc.start(t);
      osc.stop(t + 0.8);
      osc.onended = () => {
        void ctx.close().catch(() => undefined);
        setPlaying(false);
      };
    } catch {
      setPlaying(false);
      setError("Could not play a test sound on the selected output device.");
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => void play()}
        disabled={playing}
        className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
      >
        {playing ? "Playing…" : "Play test sound"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
