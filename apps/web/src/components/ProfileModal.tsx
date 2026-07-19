import { useEffect, useState } from "react";

import { useProfile, useUpdateProfile } from "../queries";
import { useSession } from "../session";
import { Avatar } from "./Avatar";

const SWATCHES = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
];

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useSession();
  const update = useUpdateProfile();
  const profile = useProfile(user?.id ?? null);
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [pronouns, setPronouns] = useState(user?.pronouns ?? "");
  const [bio, setBio] = useState("");
  const [color, setColor] = useState<string | null>(user?.accent_color ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loadedBio, setLoadedBio] = useState(false);

  // Prefill the bio (not carried in the session) once the profile loads.
  useEffect(() => {
    if (!loadedBio && profile.data) {
      setBio(profile.data.bio ?? "");
      setLoadedBio(true);
    }
  }, [profile.data, loadedBio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({
        display_name: displayName.trim() || undefined,
        accent_color: color,
        pronouns: pronouns.trim() || null,
        bio: bio.trim() || null,
      });
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  const preview = displayName.trim() || user?.display_name || "You";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit your profile"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Your profile</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950 p-3">
          <Avatar name={preview} size="lg" color={color} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">{preview}</p>
            {pronouns.trim() && <p className="text-xs text-slate-400">{pronouns.trim()}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="p-name" className="block text-sm font-medium text-slate-300">
            Display name
          </label>
          <input
            id="p-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={64}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="p-pronouns" className="block text-sm font-medium text-slate-300">
            Pronouns
          </label>
          <input
            id="p-pronouns"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            maxLength={40}
            placeholder="she/her, they/them, …"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="p-bio" className="block text-sm font-medium text-slate-300">
            About you
          </label>
          <textarea
            id="p-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            rows={3}
            placeholder="A short bio (280 characters)"
            className="mt-1 w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-300">Accent colour</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setColor(null)}
              aria-label="Default colour"
              aria-pressed={color === null}
              className={`h-7 w-7 rounded-full border-2 text-xs ${
                color === null ? "border-white" : "border-transparent"
              }`}
              style={{ background: "hsl(210 45% 28%)" }}
            >
              ⟲
            </button>
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                className={`h-7 w-7 rounded-full border-2 ${
                  color === c ? "border-white" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={update.isPending}
            className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {update.isPending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
