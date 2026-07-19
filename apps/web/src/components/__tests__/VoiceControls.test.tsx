import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VoiceControls } from "../VoiceControls";
import type { VoiceControlsProps } from "../VoiceControls";

function renderControls(overrides: Partial<VoiceControlsProps> = {}) {
  const props: VoiceControlsProps = {
    status: "connected",
    muted: false,
    deafened: false,
    onJoin: vi.fn(),
    onLeave: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleDeafen: vi.fn(),
    ...overrides,
  };
  render(<VoiceControls {...props} />);
  return props;
}

describe("VoiceControls", () => {
  it("shows a join button when idle and calls onJoin", async () => {
    const props = renderControls({ status: "idle" });
    const join = screen.getByRole("button", { name: "Join voice" });
    await userEvent.click(join);
    expect(props.onJoin).toHaveBeenCalledOnce();
  });

  it("disables the join button while connecting", () => {
    renderControls({ status: "connecting" });
    expect(screen.getByRole("button", { name: "Joining…" })).toBeDisabled();
  });

  it("offers rejoin after an unexpected disconnect", () => {
    renderControls({ status: "disconnected" });
    expect(screen.getByRole("button", { name: "Rejoin voice" })).toBeEnabled();
  });

  it("exposes mute state via aria-pressed and toggles with keyboard", async () => {
    const props = renderControls({ muted: false });
    const mute = screen.getByRole("button", { name: "Mute" });
    expect(mute).toHaveAttribute("aria-pressed", "false");
    mute.focus();
    await userEvent.keyboard("{Enter}");
    expect(props.onToggleMute).toHaveBeenCalledOnce();
  });

  it("renders muted and deafened states", () => {
    renderControls({ muted: true, deafened: true });
    expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Undeafen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows leave while connected and calls onLeave", async () => {
    const props = renderControls();
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(props.onLeave).toHaveBeenCalledOnce();
  });
});
