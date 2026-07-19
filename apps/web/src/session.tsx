/**
 * Production session state (ADR-0004): HttpOnly cookie sessions. The browser
 * holds no token — the server sets/reads the cookie; we only track the user.
 * On load we restore the session with GET /auth/session, so refreshing the
 * page keeps you signed in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api } from "./api/client";

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
}

export type SessionStatus = "loading" | "signed-out" | "signed-in";

interface AuthResult {
  error: string | null;
}

interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  signIn: (username: string, password: string) => Promise<AuthResult>;
  signUp: (username: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const AUTH_ERRORS: Record<string, string> = {
  invalid_credentials: "Invalid username or password.",
  username_taken: "That username is already taken.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  validation_error:
    "Usernames are 3–32 characters (letters, numbers, - and _); passwords are at least 10 characters.",
};

function describeAuthError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? "unknown";
  return AUTH_ERRORS[code] ?? "Something went wrong. Please try again.";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.GET("/api/v1/auth/session");
        if (cancelled) return;
        if (data) {
          setUser(data.user);
          setStatus("signed-in");
        } else {
          setStatus("signed-out");
        }
      } catch {
        if (!cancelled) setStatus("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(
    async (path: "/api/v1/auth/login" | "/api/v1/auth/register", username: string, password: string) => {
      try {
        let { data, error } = await api.POST(path, { body: { username, password } });
        // First-ever request in a fresh browser may predate the CSRF cookie;
        // the failed response set it, so one retry succeeds.
        if (error && (error as { code?: string }).code === "csrf_failed") {
          ({ data, error } = await api.POST(path, { body: { username, password } }));
        }
        if (error || !data) return { error: describeAuthError(error) };
        setUser(data.user);
        setStatus("signed-in");
        return { error: null };
      } catch {
        return { error: "Could not reach the server. Is it running?" };
      }
    },
    [],
  );

  const signIn = useCallback(
    (username: string, password: string) => authenticate("/api/v1/auth/login", username, password),
    [authenticate],
  );
  const signUp = useCallback(
    (username: string, password: string) =>
      authenticate("/api/v1/auth/register", username, password),
    [authenticate],
  );

  const signOut = useCallback(async () => {
    try {
      await api.POST("/api/v1/auth/logout");
    } catch {
      // Even if the server is unreachable, clear the local state; the cookie
      // session will be rejected server-side once connectivity returns.
    }
    setUser(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut }),
    [status, user, signIn, signUp, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
