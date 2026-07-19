import { useState } from "react";
import type { FormEvent } from "react";

import { useSession } from "../session";

type Mode = "signin" | "signup";

export function AuthScreen() {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const action = mode === "signin" ? signIn : signUp;
    const result = await action(username.trim(), password);
    setBusy(false);
    if (result.error) setError(result.error);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-base font-semibold">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {mode === "signin"
            ? "Welcome back."
            : "Pick a username and a password of at least 10 characters."}
        </p>
        <form
          onSubmit={onSubmit}
          className="mt-5 space-y-4"
          aria-label={mode === "signin" ? "Sign in" : "Create account"}
        >
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
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 10 : 1}
              maxLength={128}
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
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-400">
          {mode === "signin" ? (
            <>
              New here?{" "}
              <button
                onClick={() => switchMode("signup")}
                className="font-medium text-sky-400 hover:underline"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => switchMode("signin")}
                className="font-medium text-sky-400 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
        {mode === "signup" && (
          <p className="mt-3 text-xs text-amber-300/80">
            Heads up: password recovery does not exist yet — there is no email on file. If you
            lose this password, the account cannot be recovered.
          </p>
        )}
      </div>
    </div>
  );
}
