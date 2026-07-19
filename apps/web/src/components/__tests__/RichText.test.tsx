import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichText } from "../RichText";

describe("RichText (XSS-safe message rendering)", () => {
  it("renders HTML/script as literal text, never as markup", () => {
    const evil = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const { container } = render(<RichText text={evil} />);
    // The dangerous markup is present only as text content…
    expect(container.textContent).toContain(evil);
    // …and NO actual script/img element was created from the message.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("autolinks URLs with safe rel attributes", () => {
    render(<RichText text="see https://example.com/x for more" />);
    const link = screen.getByRole("link", { name: "https://example.com/x" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not linkify javascript: or other non-http schemes", () => {
    const { container } = render(<RichText text="javascript:alert(1) data:text/html,x" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("javascript:alert(1)");
  });

  it("renders bold, italic, and code markup as elements", () => {
    const { container } = render(<RichText text="a **bold** b *italic* c `code`" />);
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("italic");
    expect(container.querySelector("code")).toHaveTextContent("code");
  });

  it("leaves markup markers inside code spans literal", () => {
    const { container } = render(<RichText text="`**not bold**`" />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")).toHaveTextContent("**not bold**");
  });
});
