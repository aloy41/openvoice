import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../api/client";
import { SessionProvider } from "../../session";
import { LoginScreen } from "../LoginScreen";

vi.mock("../../api/client", () => ({
  api: { POST: vi.fn() },
}));

const mockPost = vi.mocked(api.POST);

function renderLogin() {
  render(
    <SessionProvider>
      <LoginScreen />
    </SessionProvider>,
  );
}

async function fillAndSubmit(username = "alice", password = "dev-password-123") {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Development password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always shows the honest encryption notice", () => {
    renderLogin();
    expect(screen.getByRole("note", { name: "Encryption status" })).toHaveTextContent(
      "not end-to-end encrypted",
    );
  });

  it("submits credentials to the dev session endpoint", async () => {
    mockPost.mockResolvedValue({
      data: {
        token: "t",
        expires_in: 3600,
        user: { id: "1", username: "alice", display_name: "alice" },
      },
      error: undefined,
    } as never);
    renderLogin();
    await fillAndSubmit();
    expect(mockPost).toHaveBeenCalledWith("/api/v1/dev/session", {
      body: { username: "alice", password: "dev-password-123" },
    });
  });

  it("shows a friendly error for a wrong password", async () => {
    mockPost.mockResolvedValue({
      data: undefined,
      error: { code: "invalid_credentials", message: "…" },
    } as never);
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That development password is incorrect.",
    );
  });

  it("shows a server-unreachable error when the request throws", async () => {
    mockPost.mockRejectedValue(new TypeError("fetch failed"));
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
