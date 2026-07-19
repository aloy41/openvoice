import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useCreateChannel } from "../queries";
import type { CommunityDetail } from "../queries";

interface CreateChannelDialogProps {
  detail: CommunityDetail;
  /** "category" creates a category; otherwise a text/voice channel. */
  mode: "channel" | "category";
  defaultParentId?: string | null;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}

export function CreateChannelDialog({
  detail,
  mode,
  defaultParentId = null,
  onClose,
  onCreated,
}: CreateChannelDialogProps) {
  const create = useCreateChannel(detail.community.id);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
  const [parentId, setParentId] = useState<string | null>(defaultParentId);
  const [error, setError] = useState<string | null>(null);

  const categories = detail.channels.filter((c) => c.kind === "category");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync(
        mode === "category"
          ? { name: name.trim(), kind: "category" }
          : { name: name.trim(), kind, parent_id: parentId },
      );
      onCreated(created.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create it.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "category" ? "Create a category" : "Create a channel"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-700 bg-slate-900 p-6"
      >
        <h2 className="text-base font-semibold">
          {mode === "category" ? "Create a category" : "Create a channel"}
        </h2>

        {mode === "channel" && (
          <fieldset>
            <legend className="text-sm font-medium text-slate-300">Channel type</legend>
            <div className="mt-2 flex gap-2">
              {(["text", "voice"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${
                    kind === k
                      ? "border-sky-600 bg-sky-950/60 text-sky-200"
                      : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {k === "text" ? "# Text" : "🔊 Voice"}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor="channel-name" className="block text-sm font-medium text-slate-300">
            Name
          </label>
          <input
            id="channel-name"
            autoFocus
            required
            minLength={1}
            maxLength={64}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        {mode === "channel" && categories.length > 0 && (
          <div>
            <label htmlFor="channel-category" className="block text-sm font-medium text-slate-300">
              Category
            </label>
            <select
              id="channel-category"
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending || name.trim() === ""}
            className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
