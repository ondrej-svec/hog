import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { SearchBarProps } from "./search-bar.js";
import { SearchBar } from "./search-bar.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderSearchBar(overrides: Partial<SearchBarProps> = {}) {
  const props: SearchBarProps = {
    defaultValue: "",
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return render(React.createElement(SearchBar, props));
}

describe("SearchBar", () => {
  it("renders the '/' prefix indicator", async () => {
    const { lastFrame } = renderSearchBar();
    await delay(50);
    expect(lastFrame()).toContain("/");
  });

  it("renders placeholder text when no defaultValue is given", async () => {
    const { lastFrame } = renderSearchBar({ defaultValue: "" });
    await delay(50);
    expect(lastFrame()).toContain("search...");
  });

  it("renders the defaultValue when provided", async () => {
    const { lastFrame } = renderSearchBar({ defaultValue: "fix bug" });
    await delay(50);
    expect(lastFrame()).toContain("fix bug");
  });

  it("does not show placeholder when defaultValue is set", async () => {
    const { lastFrame } = renderSearchBar({ defaultValue: "something" });
    await delay(50);
    expect(lastFrame()).not.toContain("search...");
  });

  it("calls onChange as the user types", async () => {
    const onChange = vi.fn();
    const { stdin } = renderSearchBar({ onChange });
    await delay(50);

    stdin.write("a");
    await delay(50);

    expect(onChange).toHaveBeenCalled();
  });

  it("calls onSubmit when Enter is pressed", async () => {
    const onSubmit = vi.fn();
    const { stdin } = renderSearchBar({ onSubmit });
    await delay(50);

    stdin.write("\r");
    await delay(50);

    expect(onSubmit).toHaveBeenCalled();
  });
});
