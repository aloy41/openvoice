/** Deterministic colored initial avatar. Pure presentation — the color and
 * initials derive from the name, so the same person looks the same everywhere. */

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

export function Avatar({
  name,
  size = "md",
  speaking = false,
}: {
  name: string;
  size?: keyof typeof SIZES;
  speaking?: boolean;
}) {
  const hue = hashHue(name);
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${SIZES[size]} ${
        speaking ? "ring-2 ring-emerald-400" : ""
      }`}
      style={{ backgroundColor: `hsl(${hue} 55% 40%)` }}
    >
      {initials(name)}
    </span>
  );
}
