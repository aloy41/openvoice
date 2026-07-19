import { useState } from "react";

import { useCreateInvite } from "../queries";
import type { ChannelInfo, CommunityDetail } from "../queries";
import type { UseVoiceRoom } from "../voice/useVoiceRoom";

interface ChannelSidebarProps {
  detail: CommunityDetail | null;
  loading: boolean;
  selectedChannelId: string | null;
  onSelectChannel: (id: string) => void;
  voice: UseVoiceRoom;
}

export function ChannelSidebar({
  detail,
  loading,
  selectedChannelId,
  onSelectChannel,
  voice,
}: ChannelSidebarProps) {
  const createInvite = useCreateInvite(detail?.community.id ?? null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canInvite = detail?.my_capabilities.includes("CREATE_INVITE") ?? false;

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

  const categories = detail?.channels.filter((c) => c.kind === "category") ?? [];
  const childrenOf = (parentId: string | null): ChannelInfo[] =>
    detail?.channels.filter((c) => c.kind !== "category" && c.parent_id === parentId) ?? [];
  const orphans = childrenOf(null);

  function channelButton(channel: ChannelInfo) {
    const selected = channel.id === selectedChannelId;
    const inThisCall = voice.channel?.id === channel.id && voice.status !== "idle";
    return (
      <li key={channel.id}>
        <button
          onClick={() => onSelectChannel(channel.id)}
          aria-current={selected ? "page" : undefined}
          aria-label={`${channel.kind === "voice" ? "Voice" : "Text"} channel ${channel.name}`}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
            selected ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/60"
          }`}
        >
          <span aria-hidden className="text-slate-500">
            {channel.kind === "voice" ? "🔊" : "#"}
          </span>
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
          {inThisCall && (
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-400" title="Connected" />
          )}
        </button>
      </li>
    );
  }

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="truncate text-sm font-semibold">
          {loading ? "Loading…" : (detail?.community.name ?? "")}
        </h2>
      </div>
      <nav aria-label="Channels" className="min-h-0 flex-1 overflow-y-auto p-2">
        {orphans.length > 0 && <ul className="space-y-0.5">{orphans.map(channelButton)}</ul>}
        {categories.map((cat) => (
          <div key={cat.id} className="mt-2">
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {cat.name}
            </p>
            <ul className="space-y-0.5">{childrenOf(cat.id).map(channelButton)}</ul>
          </div>
        ))}
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
    </div>
  );
}
