import { useState } from "react";

import {
  useCreateInvite,
  useDeleteChannel,
  useDeleteCommunity,
  useLeaveCommunity,
  useRenameChannel,
  useRenameCommunity,
} from "../queries";
import type { ChannelInfo, CommunityDetail } from "../queries";
import { useSession } from "../session";
import type { UseVoiceRoom } from "../voice/useVoiceRoom";
import { Avatar } from "./Avatar";
import { CreateChannelDialog } from "./CreateChannelDialog";

interface ChannelSidebarProps {
  detail: CommunityDetail | null;
  loading: boolean;
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  unread: Set<string>;
  voice: UseVoiceRoom;
  // Called after the user deletes or leaves the community so the app can
  // deselect it and return to the home pane.
  onCommunityGone: () => void;
}

export function ChannelSidebar({
  detail,
  loading,
  selectedChannelId,
  onSelectChannel,
  unread,
  voice,
  onCommunityGone,
}: ChannelSidebarProps) {
  const { user } = useSession();
  const createInvite = useCreateInvite(detail?.community.id ?? null);
  const renameChannel = useRenameChannel(detail?.community.id ?? null);
  const deleteChannel = useDeleteChannel(detail?.community.id ?? null);
  const renameCommunity = useRenameCommunity(detail?.community.id ?? null);
  const deleteCommunity = useDeleteCommunity(detail?.community.id ?? null);
  const leaveCommunity = useLeaveCommunity(detail?.community.id ?? null);
  const [danger, setDanger] = useState<"delete" | "leave" | null>(null);
  const isOwner = !!detail && !!user && detail.community.owner_id === user.id;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [communityNameDraft, setCommunityNameDraft] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "channel" | "category"; parentId: string | null } | null>(
    null,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canInvite = detail?.my_capabilities.includes("CREATE_INVITE") ?? false;
  const canManage = detail?.my_capabilities.includes("MANAGE_CHANNELS") ?? false;
  const canManageCommunity = detail?.my_capabilities.includes("MANAGE_COMMUNITY") ?? false;

  async function onInvite() {
    setInviteError(null);
    setCopied(false);
    try {
      const invite = await createInvite.mutateAsync();
      setInviteCode(invite.code);
    } catch {
      setInviteError("Could not create an invite.");
    }
  }

  async function copyCode() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
    } catch {
      // Clipboard unavailable — the code is visible for manual copying.
    }
  }

  async function saveRename(channel: ChannelInfo) {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name || name === channel.name) return;
    await renameChannel.mutateAsync({ channelId: channel.id, name }).catch(() => undefined);
  }

  const categories = detail?.channels.filter((c) => c.kind === "category") ?? [];
  const childrenOf = (parentId: string | null): ChannelInfo[] =>
    detail?.channels.filter((c) => c.kind !== "category" && c.parent_id === parentId) ?? [];
  const orphans = childrenOf(null);

  function channelRow(channel: ChannelInfo) {
    const selected = channel.id === selectedChannelId;
    const inThisCall = voice.channel?.id === channel.id && voice.status !== "idle";
    if (renamingId === channel.id) {
      return (
        <li key={channel.id} className="px-1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveRename(channel);
            }}
          >
            <label htmlFor={`rename-${channel.id}`} className="sr-only">
              Rename channel
            </label>
            <input
              id={`rename-${channel.id}`}
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => void saveRename(channel)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRenamingId(null);
              }}
              maxLength={64}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
            />
          </form>
        </li>
      );
    }
    return (
      <li key={channel.id} className="group/row">
        <div className="flex items-center">
          <button
            onClick={() => onSelectChannel(channel.id)}
            aria-current={selected ? "page" : undefined}
            aria-label={`${channel.kind === "voice" ? "Voice" : "Text"} channel ${channel.name}`}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              selected ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/60"
            }`}
          >
            <span aria-hidden className="text-slate-500">
              {channel.kind === "voice" ? "🔊" : "#"}
            </span>
            <span
              className={`min-w-0 flex-1 truncate ${
                unread.has(channel.id) ? "font-semibold text-slate-100" : ""
              }`}
            >
              {channel.name}
            </span>
            {unread.has(channel.id) && (
              <span
                aria-label="unread messages"
                className="h-2 w-2 rounded-full bg-sky-400"
                title="Unread messages"
              />
            )}
            {inThisCall && (
              <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400" title="Connected" />
            )}
          </button>
          {canManage && (
            <div className="invisible flex shrink-0 gap-0.5 pr-1 group-hover/row:visible group-focus-within/row:visible">
              <button
                onClick={() => {
                  setRenamingId(channel.id);
                  setRenameDraft(channel.name);
                }}
                aria-label={`Rename ${channel.name}`}
                className="rounded px-1 text-xs text-slate-400 hover:bg-slate-700"
              >
                ✎
              </button>
              <button
                onClick={() => setConfirmDeleteId(channel.id)}
                aria-label={`Delete ${channel.name}`}
                className="rounded px-1 text-xs text-red-400 hover:bg-slate-700"
              >
                🗑
              </button>
            </div>
          )}
        </div>
        {confirmDeleteId === channel.id && (
          <div className="flex items-center gap-1 px-2 py-1 text-xs">
            <span className="text-amber-300">Delete #{channel.name}?</span>
            <button
              onClick={() => {
                setConfirmDeleteId(null);
                void deleteChannel.mutateAsync(channel.id).catch(() => undefined);
              }}
              aria-label={`Confirm delete ${channel.name}`}
              className="rounded border border-red-800 bg-red-950/60 px-1.5 py-0.5 text-red-200"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDeleteId(null)}
              className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}
        {/* Live voice participants nested under the voice channel you're in. */}
        {inThisCall && voice.participants.length > 0 && (
          <ul aria-label={`In ${channel.name}`} className="ml-6 mt-0.5 space-y-0.5">
            {voice.participants.map((p) => (
              <li key={p.identity} className="flex items-center gap-2 px-2 py-0.5">
                <Avatar name={p.name} size="sm" speaking={p.speaking} />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                  {p.name}
                  {p.isLocal && <span className="text-slate-400"> (you)</span>}
                </span>
                {p.micMuted && (
                  <span aria-label="muted" title="muted" className="text-xs text-slate-500">
                    🔇
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="truncate text-sm font-semibold">
          {loading ? "Loading…" : (detail?.community.name ?? "")}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {detail && (
            <button
              onClick={() => {
                setCommunityNameDraft(detail.community.name);
                setDanger(null);
                setSettingsOpen(true);
              }}
              aria-label="Community settings"
              title="Community settings"
              className="rounded-md border border-slate-700 px-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              ⚙
            </button>
          )}
          {canManage && detail && (
            <button
              onClick={() => setDialog({ mode: "channel", parentId: null })}
              aria-label="Add channel"
              title="Add channel"
              className="rounded-md border border-slate-700 px-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              ＋
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Channels" className="min-h-0 flex-1 overflow-y-auto p-2">
        {orphans.length > 0 && <ul className="space-y-0.5">{orphans.map(channelRow)}</ul>}
        {categories.map((cat) => (
          <div key={cat.id} className="group/cat mt-2">
            <div className="flex items-center justify-between px-2 py-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {cat.name}
              </p>
              {canManage && (
                <button
                  onClick={() => setDialog({ mode: "channel", parentId: cat.id })}
                  aria-label={`Add channel to ${cat.name}`}
                  className="invisible text-xs text-slate-400 hover:text-slate-200 group-hover/cat:visible"
                >
                  ＋
                </button>
              )}
            </div>
            <ul className="space-y-0.5">{childrenOf(cat.id).map(channelRow)}</ul>
          </div>
        ))}
        {canManage && detail && (
          <button
            onClick={() => setDialog({ mode: "category", parentId: null })}
            className="mt-3 w-full rounded-md px-2 py-1 text-left text-xs text-slate-400 hover:bg-slate-800/60"
          >
            ＋ Add category
          </button>
        )}
      </nav>

      <div className="space-y-2 border-t border-slate-800 p-3">
        {voice.channel && voice.status !== "idle" && (
          <div className="flex items-center justify-between rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1.5 text-xs text-emerald-200">
            <span className="min-w-0 truncate">
              Voice: {voice.channel.name}
              {voice.status === "reconnecting" ? " (reconnecting…)" : ""}
            </span>
            <button
              onClick={() => void voice.leave()}
              className="ml-2 shrink-0 rounded border border-emerald-700 px-1.5 py-0.5 hover:bg-emerald-900/60"
            >
              Leave
            </button>
          </div>
        )}
        {canInvite && (
          <button
            onClick={() => void onInvite()}
            disabled={createInvite.isPending}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
          >
            {createInvite.isPending ? "Creating invite…" : "Invite people"}
          </button>
        )}
        {inviteError && (
          <p role="alert" className="text-xs text-red-400">
            {inviteError}
          </p>
        )}
        {inviteCode && (
          <div className="space-y-1 rounded-md border border-slate-700 bg-slate-950 p-2">
            <p className="text-xs text-slate-400">Share this code (valid 7 days):</p>
            <p data-testid="invite-code" className="break-all font-mono text-sm text-slate-100">
              {inviteCode}
            </p>
            <button
              onClick={() => void copyCode()}
              className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
      </div>

      {dialog && detail && (
        <CreateChannelDialog
          detail={detail}
          mode={dialog.mode}
          defaultParentId={dialog.parentId}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            if (dialog.mode === "channel") onSelectChannel(id);
          }}
        />
      )}

      {settingsOpen && detail && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Community settings"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-5 rounded-lg border border-slate-700 bg-slate-900 p-6"
          >
            <h2 className="text-base font-semibold">Community settings</h2>

            {canManageCommunity && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = communityNameDraft.trim();
                  if (name && name !== detail.community.name) {
                    void renameCommunity.mutateAsync(name).catch(() => undefined);
                  }
                  setSettingsOpen(false);
                }}
                className="space-y-3"
              >
                <div>
                  <label
                    htmlFor="community-rename"
                    className="block text-sm font-medium text-slate-300"
                  >
                    Community name
                  </label>
                  <input
                    id="community-rename"
                    autoFocus
                    value={communityNameDraft}
                    onChange={(e) => setCommunityNameDraft(e.target.value)}
                    maxLength={64}
                    minLength={1}
                    required
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800"
                  >
                    Save name
                  </button>
                </div>
              </form>
            )}

            {/* Danger zone: leave (members) or delete (owner). */}
            <div className="space-y-2 border-t border-slate-800 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Danger zone
              </p>

              {!isOwner && danger !== "leave" && (
                <button
                  onClick={() => setDanger("leave")}
                  className="w-full rounded-md border border-amber-800 px-3 py-2 text-sm text-amber-200 hover:bg-amber-950/40"
                >
                  Leave community
                </button>
              )}
              {!isOwner && danger === "leave" && (
                <div className="space-y-2 rounded-md border border-amber-800 bg-amber-950/30 p-3">
                  <p className="text-sm text-amber-100">
                    Leave <strong>{detail.community.name}</strong>? You'll need a new invite to
                    rejoin.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setDanger(null)}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={leaveCommunity.isPending}
                      onClick={() => {
                        void leaveCommunity
                          .mutateAsync()
                          .then(() => {
                            setSettingsOpen(false);
                            onCommunityGone();
                          })
                          .catch(() => undefined);
                      }}
                      className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                    >
                      {leaveCommunity.isPending ? "Leaving…" : "Leave"}
                    </button>
                  </div>
                </div>
              )}

              {isOwner && danger !== "delete" && (
                <button
                  onClick={() => setDanger("delete")}
                  className="w-full rounded-md border border-red-800 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40"
                >
                  Delete community
                </button>
              )}
              {isOwner && danger === "delete" && (
                <div className="space-y-2 rounded-md border border-red-800 bg-red-950/30 p-3">
                  <p className="text-sm text-red-100">
                    Permanently delete <strong>{detail.community.name}</strong> and all its
                    channels and messages? This cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setDanger(null)}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={deleteCommunity.isPending}
                      onClick={() => {
                        void deleteCommunity
                          .mutateAsync()
                          .then(() => {
                            setSettingsOpen(false);
                            onCommunityGone();
                          })
                          .catch(() => undefined);
                      }}
                      className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      {deleteCommunity.isPending ? "Deleting…" : "Delete forever"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
