import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionBanner } from "../ConnectionBanner";

describe("ConnectionBanner", () => {
  it("renders nothing for idle without error", () => {
    render(<ConnectionBanner status="idle" error={null} />);
    expect(screen.queryByTestId("connection-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("voice-error")).not.toBeInTheDocument();
  });

  it("shows reconnecting state", () => {
    render(<ConnectionBanner status="reconnecting" error={null} />);
    expect(screen.getByTestId("connection-status")).toHaveTextContent(
      "Connection lost — reconnecting…",
    );
  });

  it("shows disconnected state", () => {
    render(<ConnectionBanner status="disconnected" error={null} />);
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Disconnected");
  });

  it("announces errors via role=alert with an actionable message", () => {
    render(
      <ConnectionBanner
        status="idle"
        error={{
          code: "mic_permission_denied",
          message: "Microphone access was denied. Allow microphone access…",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Microphone access was denied");
  });
});
