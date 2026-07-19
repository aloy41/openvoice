import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { decryptMessage, encryptMessage, MESSAGE_SCHEME } from "../crypto/envelope";
import type { ChannelInfo, MessageInfo } from "../queries";
import { useDeleteMessage, useEditMessage, useMessages, useSendMessage } from "../queries";
import { useSession } from "../session";

interface TextChannelViewProps {
  channel: ChannelInfo;
  passphrase: string;
  onPassphraseChange: (value: string) => void;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Async-decrypt every passphrase-v1 message; plaintext passes through.
 * Returns a map of message id → decrypted text (or null if undecryptable). */
function useDecryptedContent(
  messages: MessageInfo[] | undefined,
  passphrase: string,
): Map<string, string | null> {
  const [decrypted, setDecrypted] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, string | null>();
      for (const m of messages ?? []) {
        if (m.deleted || m.scheme !== MESSAGE_SCHEME) continue;
        next.set(m.id, passphrase ? await decryptMessage(passphrase, m.content) : null);
      }
      if (!cancelled) setDecrypted(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, passphrase]);
  return decrypted;
}

export function TextChannelView({ channel, passphrase, onPassphraseChange }: TextChannelViewProps) {
  const { user } = useSession();
  const messages = useMessages(channel.id);
  const send = useSendMessage(channel.id);
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const decrypted = useDecryptedContent(messages.data, passphrase);

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const canSend = channel.capabilities.includes("SEND_MESSAGES");
  const canManage = channel.capabilities.includes("MANAGE_MESSAGES");
  const encrypting = passphrase.trim().length > 0;
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  /** Displayed text + whether it is an encrypted message we can't read. */
  function display(m: MessageInfo): { text: string; locked: boolean } {
    if (m.deleted) return { text: "message deleted", locked: false };
    if (m.scheme !== MESSAGE_SCHEME) return { text: m.content, locked: false };
    const plain = decrypted.get(m.id);
    if (plain != null) return { text: plain, locked: false };
    return {
      text: passphrase
        ? "🔒 can't decrypt — wrong passphrase for this message"
        : "🔒 encrypted — enter the channel passphrase to read",
      locked: true,
    };
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSendError(null);
    try {
      if (encrypting) {
        const envelope = await encryptMessage(passphrase, content);
        await send.mutateAsync({ content: envelope, scheme: MESSAGE_SCHEME });
      } else {
        await send.mutateAsync({ content });
      }
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "The message could not be sent.");
    }
  }

  async function onSaveEdit(m: MessageInfo) {
    const content = editDraft.trim();
    setEditingId(null);
    if (!content) return;
    try {
      if (m.scheme === MESSAGE_SCHEME && passphrase) {
        const envelope = await encryptMessage(passphrase, content);
        await editMessage.mutateAsync({ messageId: m.id, content: envelope, scheme: MESSAGE_SCHEME });
      } else {
        await editMessage.mutateAsync({ messageId: m.id, content, scheme: "plaintext" });
      }
    } catch {
      setSendError("The edit could not be saved.");
    }
  }

  return (
    <section
      aria-label={`Text channel ${channel.name}`}
      className="flex h-full min-h-0 flex-col rounded-lg border border-slate-800 bg-slate-900"
    >
      <div className="space-y-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {encrypting ? "🔐" : "#"} {channel.name}
          </h2>
        </div>
        <div>
          <label htmlFor="msg-passphrase" className="sr-only">
            Message encryption passphrase for this channel
          </label>
          <input
            id="msg-passphrase"
            type="password"
            autoComplete="off"
            placeholder="Message passphrase (optional — encrypts new messages)"
            value={passphrase}
            onChange={(e) => onPassphraseChange(e.target.value)}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
          />
          <p className="mt-1 text-xs text-slate-400">
            {encrypting
              ? "New messages are end-to-end encrypted — the server stores only ciphertext. Everyone needs the same passphrase (shared outside this app)."
              : "Without a passphrase, messages are stored server-readable (transport-encrypted only)."}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.isLoading && <p className="text-sm text-slate-400">Loading messages…</p>}
        {messages.data?.length === 0 && (
          <p className="text-sm text-slate-400">No messages yet. Say something.</p>
        )}
        <ol aria-label="Messages" className="space-y-2">
          {messages.data?.map((m) => {
            const shown = display(m);
            return (
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
                      {m.scheme === MESSAGE_SCHEME && !shown.locked && (
                        <span className="ml-1 text-xs text-emerald-400" title="End-to-end encrypted">
                          🔐
                        </span>
                      )}
                      {m.edited_at && <span className="ml-1 text-xs text-slate-500">(edited)</span>}
                      <p
                        className={`whitespace-pre-wrap break-words text-sm ${
                          shown.locked ? "italic text-slate-500" : "text-slate-100"
                        }`}
                      >
                        {shown.text}
                      </p>
                    </div>
                    <div className="invisible flex shrink-0 gap-1 group-hover:visible group-focus-within:visible">
                      {m.author_id === user?.id && !shown.locked && (
                        <button
                          onClick={() => {
                            setEditingId(m.id);
                            setEditDraft(shown.text);
                          }}
                          aria-label={`Edit message: ${shown.text.slice(0, 30)}`}
                          className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                        >
                          Edit
                        </button>
                      )}
                      {(m.author_id === user?.id || canManage) && (
                        <button
                          onClick={() => void deleteMessage.mutateAsync(m.id).catch(() => undefined)}
                          aria-label={`Delete message from ${m.author_name}`}
                          className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-red-300 hover:bg-slate-700"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
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
              placeholder={encrypting ? `Encrypted message to #${channel.name}` : `Message #${channel.name}`}
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
