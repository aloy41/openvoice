import { useState } from "react";

import type { MessageInfo } from "../queries";
import { useToggleReaction } from "../queries";
import { useSession } from "../session";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "😮", "😢", "🙏", "✅", "💯", "👏"];

type Reaction = NonNullable<MessageInfo["reactions"]>[number];

export function Reactions({
  messageId,
  reactions,
}: {
  messageId: string;
  reactions: Reaction[] | undefined;
}) {
  const { user } = useSession();
  const toggle = useToggleReaction();
  const [pickerOpen, setPickerOpen] = useState(false);

  function react(emoji: string) {
    setPickerOpen(false);
    void toggle.mutateAsync({ messageId, emoji }).catch(() => undefined);
  }

  const chips = (reactions ?? []).filter((r) => r.user_ids.length > 0);
  if (chips.length === 0 && !pickerOpen) {
    return (
      <div className="mt-0.5">
        <button
          onClick={() => setPickerOpen(true)}
          aria-label="Add reaction"
          className="invisible rounded-md border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700 group-hover:visible group-focus-within:visible"
        >
          😊 +
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {chips.map((r) => {
        const mine = user ? r.user_ids.includes(user.id) : false;
        return (
          <button
            key={r.emoji}
            onClick={() => react(r.emoji)}
            aria-label={`${r.emoji} ${r.user_ids.length}${mine ? " (you reacted)" : ""}`}
            aria-pressed={mine}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
              mine
                ? "border-sky-600 bg-sky-950/60 text-sky-200"
                : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <span>{r.emoji}</span>
            <span>{r.user_ids.length}</span>
          </button>
        );
      })}
      <div className="relative">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Add reaction"
          aria-expanded={pickerOpen}
          className="rounded-md border border-slate-700 px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700"
        >
          😊 +
        </button>
        {pickerOpen && (
          <div
            role="menu"
            aria-label="Pick a reaction"
            className="absolute z-10 mt-1 flex flex-wrap gap-1 rounded-md border border-slate-700 bg-slate-900 p-2 shadow-lg"
            style={{ width: "12rem" }}
          >
            {QUICK_EMOJI.map((e) => (
              <button
                key={e}
                role="menuitem"
                onClick={() => react(e)}
                aria-label={`React ${e}`}
                className="rounded p-1 text-lg hover:bg-slate-800"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
