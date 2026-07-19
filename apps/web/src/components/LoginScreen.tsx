import { useState } from "react";
import type { FormEvent } from "react";

import { useSession } from "../session";
import { EncryptionNotice } from "./EncryptionNotice";

export function LoginScreen() {
  const { signIn } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(username.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <EncryptionNotice />
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-base font-semibold">Development sign-in</h2>
        <p className="mt-1 text-sm text-slate-400">
          This is a development build. Pick any username and enter this server's development
          password.
        </p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4" aria-label="Development sign-in">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-300">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_\-]+"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300">
              Development password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
