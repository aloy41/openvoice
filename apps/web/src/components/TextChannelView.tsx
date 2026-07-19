import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { ChannelInfo, MessageInfo } from "../queries";
import { useDeleteMessage, useEditMessage, useMessages, useSendMessage } from "../queries";
import { useSession } from "../session";

interface TextChannelViewProps {
  channel: ChannelInfo;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TextChannelView({ channel }: TextChannelViewProps) {
  const { user } = useSession();
  const messages = useMessages(channel.id);
  const send = useSendMessage(channel.id);
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const canSend = channel.capabilities.includes("SEND_MESSAGES");
  const canManage = channel.capabilities.includes("MANAGE_MESSAGES");
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSendError(null);
    try {
      await send.mutateAsync(content);
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "The message could not be sent.");
    }
  }

  async function onSaveEdit(message: MessageInfo) {
    const content = editDraft.trim();
    setEditingId(null);
    if (!content || content === message.content) return;
    try {
      await editMessage.mutateAsync({ messageId: message.id, content });
    } catch {
      setSendError("The edit could not be saved.");
    }
  }

  return (
    <section
      aria-label={`Text channel ${channel.name}`}
      className="flex h-full min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-900"
    >
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-base font-semibold"># {channel.name}</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.isLoading && <p className="text-sm text-slate-400">Loading messages…</p>}
        {messages.data?.length === 0 && (
          <p className="text-sm text-slate-400">No messages yet. Say something.</p>
        )}
        <ol aria-label="Messages" className="space-y-2">
          {messages.data?.map((m) => (
            <li key={m.id} className="group rounded-md px-2 py-1 hover:bg-slate-800/40">
              {m.deleted ? (
                <p className="text-sm italic text-slate-500">message deleted</p>
              ) : editingId === m.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onSaveEdit(m);
                  }}
                  className="flex gap-2"
                >
                  <label htmlFor={`edit-${m.id}`} className="sr-only">
                    Edit message
                  </label>
                  <input
                    id={`edit-${m.id}`}
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    maxLength={4000}
                    className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  />
                  <button type="submit" className="rounded border border-slate-700 px-2 text-xs">
                    Save
                  </button>
                </form>
              ) : (
                <div className="flex items-baseline gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-200">{m.author_name}</span>
                    <span className="ml-2 text-xs text-slate-500">{timeOf(m.created_at)}</span>
                    {m.edited_at && (
                      <span className="ml-1 text-xs text-slate-500">(edited)</span>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-100">
                      {m.content}
                    </p>
                  </div>
                  <div className="invisible flex shrink-0 gap-1 group-hover:visible group-focus-within:visible">
                    {m.author_id === user?.id && (
                      <button
                        onClick={() => {
                          setEditingId(m.id);
                          setEditDraft(m.content);
                        }}
                        aria-label={`Edit message: ${m.content.slice(0, 30)}`}
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                      >
                        Edit
                      </button>
                    )}
                    {(m.author_id === user?.id || canManage) && (
                      <button
                        onClick={() => void deleteMessage.mutateAsync(m.id).catch(() => undefined)}
                        aria-label={`Delete message: ${m.content.slice(0, 30)}`}
                        className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-red-300 hover:bg-slate-700"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-800 p-3">
        {canSend ? (
          <form onSubmit={onSend} className="flex gap-2" aria-label="Send a message">
            <label htmlFor="composer" className="sr-only">
              Message #{channel.name}
            </label>
            <input
              id="composer"
              placeholder={`Message #${channel.name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={4000}
              className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={send.isPending || draft.trim() === ""}
              className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
            >
              Send
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-400">
            You don't have permission to send messages in this channel.
          </p>
        )}
        {sendError && (
          <p role="alert" className="mt-2 text-sm text-red-400">
            {sendError}
          </p>
        )}
      </div>
    </section>
  );
}
