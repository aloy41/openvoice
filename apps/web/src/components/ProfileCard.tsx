import { useEffect } from "react";

import { useProfile } from "../queries";
import { Avatar } from "./Avatar";

/** Read-only profile card for another user, opened by clicking their avatar. */
export function ProfileCard({ userId, onClose }: { userId: string; onClose: () => void }) {
  const profile = useProfile(userId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p = profile.data;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-700 bg-slate-900"
      >
        <div className="h-16" style={{ background: p?.accent_color ?? "hsl(210 45% 28%)" }} />
        <div className="-mt-8 px-6 pb-6">
          {p ? (
            <>
              <div className="ring-4 ring-slate-900" style={{ width: "fit-content", borderRadius: "9999px" }}>
                <Avatar name={p.display_name} size="lg" color={p.accent_color} />
              </div>
              <h2 className="mt-2 text-base font-semibold text-slate-100">{p.display_name}</h2>
              <p className="text-xs text-slate-500">@{p.username}</p>
              {p.pronouns && <p className="mt-1 text-sm text-slate-400">{p.pronouns}</p>}
              {p.bio && (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-200">
                  {p.bio}
                </p>
              )}
              {!p.bio && !p.pronouns && (
                <p className="mt-3 text-sm text-slate-500">No bio yet.</p>
              )}
            </>
          ) : (
            <p className="pt-10 text-sm text-slate-400">Loading…</p>
          )}
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
