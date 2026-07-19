import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthScreen } from "./components/AuthScreen";
import { CommunityApp } from "./components/CommunityApp";
import { DevicesModal } from "./components/DevicesModal";
import { EncryptionDialog } from "./components/EncryptionDialog";
import { SessionProvider, useSession } from "./session";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
});

function Shell() {
  const { status, user, signOut } = useSession();
  const [showDevices, setShowDevices] = useState(false);
  const [showEncryption, setShowEncryption] = useState(false);
  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-slate-800 px-6 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Openvoice</h1>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-400">
                Signed in as <span className="text-slate-200">{user.display_name}</span>
              </span>
              <button
                onClick={() => setShowEncryption(true)}
                title="About encryption"
                className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
              >
                🔒 Encryption
              </button>
              <button
                onClick={() => setShowDevices(true)}
                className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
              >
                Devices
              </button>
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
      {showDevices && <DevicesModal onClose={() => setShowDevices(false)} />}
      {showEncryption && <EncryptionDialog onClose={() => setShowEncryption(false)} />}
      <div className="min-h-0 flex-1">
        {status === "loading" && (
          <p role="status" className="px-6 py-8 text-sm text-slate-400">
            Loading…
          </p>
        )}
        {status === "signed-out" && (
          <main className="overflow-y-auto px-6 py-8">
            <AuthScreen />
          </main>
        )}
        {status === "signed-in" && <CommunityApp />}
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </QueryClientProvider>
  );
}
