import { describe, expect, it } from "vitest";

import { relativeTime } from "../time";

describe("relativeTime", () => {
  const now = new Date("2026-07-19T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("shows 'just now' for very recent times", () => {
    expect(relativeTime(ago(10_000), now)).toBe("just now");
  });
  it("shows minutes, hours, and days", () => {
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5m");
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe("3h");
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe("2d");
  });
  it("falls back to a date beyond a week", () => {
    expect(relativeTime(ago(30 * 86_400_000), now)).toMatch(/[A-Za-z]{3} \d+/);
  });
});
