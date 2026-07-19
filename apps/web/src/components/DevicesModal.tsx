import { useEffect, useState } from "react";

import { getCurrentDeviceId } from "../crypto/device";
import { useDevices, useRevokeDevice } from "../queries";

interface DevicesModalProps {
  onClose: () => void;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DevicesModal({ onClose }: DevicesModalProps) {
  const devices = useDevices(true);
  const revoke = useRevokeDevice();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCurrentDeviceId().then(setCurrentId);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your devices"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Your devices</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Each device holds a private identity key that never leaves it. Revoking a device
          invalidates that key; the device must register a new one to be trusted again.
        </p>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <ul aria-label="Devices" className="mt-4 space-y-2">
          {devices.isLoading && <li className="text-sm text-slate-400">Loading…</li>}
          {devices.data?.map((d) => {
            const isCurrent = d.id === currentId;
            return (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-100">
                    {d.name ?? "Unnamed device"}
                    {isCurrent && (
                      <span className="ml-2 rounded bg-emerald-900/50 px-1.5 py-0.5 text-xs text-emerald-300">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {d.key_type} · added {when(d.created_at)} · last seen {when(d.last_seen_at)}
                  </p>
                </div>
                <button
                  onClick={() =>
                    void revoke
                      .mutateAsync(d.id)
                      .catch(() => setError("Could not revoke that device."))
                  }
                  aria-label={`Revoke ${d.name ?? "device"}${isCurrent ? " (this device)" : ""}`}
                  className="shrink-0 rounded-md border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
                >
                  Revoke
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
