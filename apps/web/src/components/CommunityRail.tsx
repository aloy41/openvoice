import type { CommunitySummary } from "../queries";

interface CommunityRailProps {
  communities: CommunitySummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function CommunityRail({ communities, selectedId, onSelect }: CommunityRailProps) {
  return (
    <nav
      aria-label="Communities"
      className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-slate-800 bg-slate-950 py-3"
    >
      <button
        onClick={() => onSelect(null)}
        aria-label="Home"
        aria-current={selectedId === null ? "page" : undefined}
        className={`flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-semibold ${
          selectedId === null
            ? "bg-sky-700 text-white"
            : "bg-slate-800 text-slate-300 hover:bg-slate-700"
        }`}
      >
        ⌂
      </button>
      <div className="h-px w-8 bg-slate-800" aria-hidden />
      <ul className="flex flex-col items-center gap-2">
        {communities.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              aria-label={`Community ${c.name}`}
              aria-current={selectedId === c.id ? "page" : undefined}
              title={c.name}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold ${
                selectedId === c.id
                  ? "bg-sky-700 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {initials(c.name)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
