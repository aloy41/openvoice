/**
 * Dev-session state. The token is deliberately kept in memory only — it dies
 * with the tab. Production auth (Milestone 2) moves to HttpOnly cookies +
 * CSRF protection (ADR-0003).
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api } from "./api/client";

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
}

export interface Session {
  token: string;
  user: SessionUser;
}

interface SessionContextValue {
  session: Session | null;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const SIGN_IN_ERRORS: Record<string, string> = {
  dev_auth_disabled: "Development sign-in is disabled on this server.",
  invalid_credentials: "That development password is incorrect.",
  validation_error: "Usernames are 3–32 characters: letters, numbers, - and _.",
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const { data, error } = await api.POST("/api/v1/dev/session", {
        body: { username, password },
      });
      if (error) {
        const code = (error as { code?: string }).code ?? "unknown";
        return { error: SIGN_IN_ERRORS[code] ?? "Sign-in failed. Please try again." };
      }
      setSession({ token: data.token, user: data.user });
      return { error: null };
    } catch {
      return { error: "Could not reach the server. Is the stack running?" };
    }
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
