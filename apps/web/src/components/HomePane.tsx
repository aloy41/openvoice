import { useState } from "react";
import type { FormEvent } from "react";

import { useCreateCommunity, useRedeemInvite } from "../queries";
import { EncryptionNotice } from "./EncryptionNotice";

interface HomePaneProps {
  onCreated: (communityId: string) => void;
  onJoined: (communityId: string) => void;
}

export function HomePane({ onCreated, onJoined }: HomePaneProps) {
  const create = useCreateCommunity();
  const redeem = useRedeemInvite();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      const detail = await create.mutateAsync(name.trim());
      setName("");
      onCreated(detail.community.id);
    } catch {
      setCreateError("Could not create the community. Try again.");
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault();
    setJoinError(null);
    try {
      const joined = await redeem.mutateAsync(code);
      setCode("");
      onJoined(joined.community_id);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "That invite is not valid.");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <EncryptionNotice />
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-base font-semibold">Create a community</h2>
        <form onSubmit={onCreate} className="mt-4 space-y-4" aria-label="Create a community">
          <div>
            <label htmlFor="community-name" className="block text-sm font-medium text-slate-300">
              Community name
            </label>
            <input
              id="community-name"
              required
              minLength={1}
              maxLength={64}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          {createError && (
            <p role="alert" className="text-sm text-red-400">
              {createError}
            </p>
          )}
          <button
            type="submit"
            disabled={create.isPending}
            className="w-full rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create community"}
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-base font-semibold">Join with an invite</h2>
        <form onSubmit={onJoin} className="mt-4 space-y-4" aria-label="Join with an invite">
          <div>
            <label htmlFor="invite-code" className="block text-sm font-medium text-slate-300">
              Invite code
            </label>
            <input
              id="invite-code"
              required
              minLength={6}
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          {joinError && (
            <p role="alert" className="text-sm text-red-400">
              {joinError}
            </p>
          )}
          <button
            type="submit"
            disabled={redeem.isPending}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          >
            {redeem.isPending ? "Joining…" : "Join community"}
          </button>
        </form>
      </div>
    </div>
  );
}
