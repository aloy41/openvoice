import { useState } from "react";

import type { CommunityDetail } from "../queries";
import { useBanMember, useBans, useKickMember, useMembers, useUnbanMember } from "../queries";
import { useSession } from "../session";
import { Avatar } from "./Avatar";
import { ProfileCard } from "./ProfileCard";

interface MembersPanelProps {
  detail: CommunityDetail;
  onlineIds: Set<string>;
}

/** Right-hand member panel with capability-gated moderation. Destructive
 * actions use an explicit two-step confirm (no window.confirm — keyboard and
 * screen-reader friendly). */
export function MembersPanel({ detail, onlineIds }: MembersPanelProps) {
  const { user } = useSession();
  const communityId = detail.community.id;
  const canKick = detail.my_capabilities.includes("KICK_MEMBERS");
  const canBan = detail.my_capabilities.includes("BAN_MEMBERS");

  const members = useMembers(communityId);
  const bans = useBans(communityId, canBan);
  const kick = useKickMember(communityId);
  const ban = useBanMember(communityId);
  const unban = useUnbanMember(communityId);

  const [confirming, setConfirming] = useState<{ action: "kick" | "ban"; userId: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);

  async function runConfirmed() {
    if (!confirming) return;
    setError(null);
    try {
      if (confirming.action === "kick") await kick.mutateAsync(confirming.userId);
      else await ban.mutateAsync(confirming.userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action failed.");
    }
    setConfirming(null);
  }

  return (
    <aside
      aria-label="Members"
      className="hidden w-64 shrink-0 flex-col overflow-y-auto border-l border-slate-800 bg-slate-900/60 p-3 lg:flex"
    >
      <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Members — {members.data?.length ?? "…"}
        {members.data && (
          <span className="ml-1 text-emerald-400">
            ({members.data.filter((m) => onlineIds.has(m.user_id)).length} online)
          </span>
        )}
      </h3>
      {error && (
        <p role="alert" className="mb-2 px-1 text-xs text-red-400">
          {error}
        </p>
      )}
      <ul className="space-y-1">
        {[...(members.data ?? [])]
          .sort(
            (a, b) =>
              Number(onlineIds.has(b.user_id)) - Number(onlineIds.has(a.user_id)) ||
              a.display_name.localeCompare(b.display_name),
          )
          .map((m) => {
          const isSelf = m.user_id === user?.id;
          const online = onlineIds.has(m.user_id);
          const moderatable = !m.is_owner && !isSelf && (canKick || canBan);
          const confirmingThis = confirming?.userId === m.user_id;
          return (
            <li
              key={m.user_id}
              className="group rounded-md px-2 py-1.5 text-sm hover:bg-slate-800/60"
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCardUserId(m.user_id)}
                  aria-label={`View ${m.display_name}'s profile`}
                  className="relative rounded-full"
                >
                  <Avatar name={m.display_name} size="sm" color={m.accent_color} />
                  <span
                    aria-label={online ? "online" : "offline"}
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${
                      online ? "bg-emerald-400" : "bg-slate-600"
                    }`}
                  />
                </button>
                <button
                  onClick={() => setCardUserId(m.user_id)}
                  className="min-w-0 flex-1 truncate text-left text-slate-200 hover:underline"
                >
                  {m.display_name}
                  {isSelf && <span className="text-slate-400"> (you)</span>}
                </button>
                {m.is_owner && (
                  <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-xs text-amber-300">
                    owner
                  </span>
                )}
              </div>
              {moderatable && !confirmingThis && (
                <div className="invisible mt-1 flex gap-1 group-hover:visible group-focus-within:visible">
                  {canKick && (
                    <button
                      onClick={() => setConfirming({ action: "kick", userId: m.user_id })}
                      aria-label={`Kick ${m.display_name}`}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      Kick
                    </button>
                  )}
                  {canBan && (
                    <button
                      onClick={() => setConfirming({ action: "ban", userId: m.user_id })}
                      aria-label={`Ban ${m.display_name}`}
                      className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-950"
                    >
                      Ban
                    </button>
                  )}
                </div>
              )}
              {confirmingThis && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-xs text-amber-300">
                    {confirming.action === "kick" ? "Kick" : "Ban"} {m.display_name}?
                  </span>
                  <button
                    onClick={() => void runConfirmed()}
                    aria-label={`Confirm ${confirming.action} ${m.display_name}`}
                    className="rounded border border-red-800 bg-red-950/60 px-1.5 py-0.5 text-xs text-red-200"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canBan && (bans.data?.length ?? 0) > 0 && (
        <>
          <h3 className="mt-4 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Banned
          </h3>
          <ul className="space-y-1">
            {bans.data?.map((b) => (
              <li
                key={b.user_id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-slate-400">{b.username}</span>
                <button
                  onClick={() => void unban.mutateAsync(b.user_id).catch(() => undefined)}
                  aria-label={`Unban ${b.username}`}
                  className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Unban
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {cardUserId && <ProfileCard userId={cardUserId} onClose={() => setCardUserId(null)} />}
    </aside>
  );
}
