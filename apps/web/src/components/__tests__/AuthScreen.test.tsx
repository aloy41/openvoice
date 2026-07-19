import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../api/client";
import { SessionProvider } from "../../session";
import { AuthScreen } from "../AuthScreen";

vi.mock("../../api/client", () => ({
  api: { GET: vi.fn(), POST: vi.fn(), use: vi.fn() },
}));

const mockGet = vi.mocked(api.GET);
const mockPost = vi.mocked(api.POST);

const USER = { id: "1", username: "alice", display_name: "alice" };
const OK = { data: { user: USER, session_expires_at: null }, error: undefined } as never;

function renderAuth() {
  render(
    <SessionProvider>
      <AuthScreen />
    </SessionProvider>,
  );
}

async function fill(username = "alice", password = "long-enough-password") {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
}

describe("AuthScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // session restore on mount: signed out
    mockGet.mockResolvedValue({ data: undefined, error: { code: "not_authenticated" } } as never);
  });

  it("signs in via the login endpoint", async () => {
    mockPost.mockResolvedValue(OK);
    renderAuth();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mockPost).toHaveBeenCalledWith("/api/v1/auth/login", {
      body: { username: "alice", password: "long-enough-password" },
    });
  });

  it("switches to account creation and registers", async () => {
    mockPost.mockResolvedValue(OK);
    renderAuth();
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(
      screen.getByText(/password recovery does not exist yet/i),
    ).toBeInTheDocument();
    await fill("newuser");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(mockPost).toHaveBeenCalledWith("/api/v1/auth/register", {
      body: { username: "newuser", password: "long-enough-password" },
    });
  });

  it("shows a friendly error for wrong credentials", async () => {
    mockPost.mockResolvedValue({
      data: undefined,
      error: { code: "invalid_credentials" },
    } as never);
    renderAuth();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password.");
  });

  it("shows a friendly error for a taken username", async () => {
    mockPost.mockResolvedValue({
      data: undefined,
      error: { code: "username_taken" },
    } as never);
    renderAuth();
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await fill("taken");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already taken");
  });

  it("retries once when the first request lacked the CSRF cookie", async () => {
    mockPost
      .mockResolvedValueOnce({ data: undefined, error: { code: "csrf_failed" } } as never)
      .mockResolvedValueOnce(OK);
    renderAuth();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a server-unreachable error when the request throws", async () => {
    mockPost.mockRejectedValue(new TypeError("fetch failed"));
    renderAuth();
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
