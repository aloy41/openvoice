import { AuthScreen } from "./components/AuthScreen";
import { VoiceScreen } from "./components/VoiceScreen";
import { SessionProvider, useSession } from "./session";

function Shell() {
  const { status, user, signOut } = useSession();
  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Openvoice</h1>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-400">
                Signed in as <span className="text-slate-200">{user.display_name}</span>
              </span>
              <button
                onClick={() => void signOut()}
                className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {status === "loading" && (
          <p role="status" className="text-sm text-slate-400">
            Loading…
          </p>
        )}
        {status === "signed-out" && <AuthScreen />}
        {status === "signed-in" && <VoiceScreen />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
