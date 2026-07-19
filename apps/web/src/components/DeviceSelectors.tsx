export interface DeviceSelectorsProps {
  mics: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  selectedMic: string;
  selectedOutput: string;
  onMicChange: (deviceId: string) => void;
  onOutputChange: (deviceId: string) => void;
}

function label(d: MediaDeviceInfo, fallback: string) {
  return d.label && d.label.length > 0 ? d.label : fallback;
}

export function DeviceSelectors({
  mics,
  outputs,
  selectedMic,
  selectedOutput,
  onMicChange,
  onOutputChange,
}: DeviceSelectorsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="mic-select" className="block text-sm font-medium text-slate-300">
          Microphone
        </label>
        <select
          id="mic-select"
          value={selectedMic}
          onChange={(e) => onMicChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          {mics.length === 0 && <option value="">No microphones found</option>}
          {mics.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {label(d, `Microphone ${i + 1}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="output-select" className="block text-sm font-medium text-slate-300">
          Output device
        </label>
        <select
          id="output-select"
          value={selectedOutput}
          onChange={(e) => onOutputChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          {outputs.length === 0 && <option value="">Default output</option>}
          {outputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {label(d, `Output ${i + 1}`)}
            </option>
          ))}
        </select>
      </div>
      {mics.some((d) => !d.label) && (
        <p className="text-xs text-slate-400 sm:col-span-2">
          Device names appear after you grant microphone access (run the mic test or join).
        </p>
      )}
    </div>
  );
}
