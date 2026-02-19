import { describe, expect, it } from "vitest";
import type { Theme } from "./theme.js";
import { darkTheme, getTheme } from "./theme.js";

describe("getTheme", () => {
  it("returns an object", () => {
    const theme = getTheme();
    expect(theme).toBeDefined();
    expect(typeof theme).toBe("object");
  });

  it("returns the darkTheme", () => {
    const theme = getTheme();
    expect(theme).toBe(darkTheme);
  });

  it("returns an object with a text property containing all required keys", () => {
    const theme = getTheme();
    expect(typeof theme.text).toBe("object");
    expect(typeof theme.text.primary).toBe("function");
    expect(typeof theme.text.secondary).toBe("function");
    expect(typeof theme.text.muted).toBe("function");
    expect(typeof theme.text.success).toBe("function");
    expect(typeof theme.text.warning).toBe("function");
    expect(typeof theme.text.error).toBe("function");
    expect(typeof theme.text.accent).toBe("function");
  });

  it("returns an object with a border property containing all required keys", () => {
    const theme = getTheme();
    expect(typeof theme.border).toBe("object");
    expect(typeof theme.border.primary).toBe("function");
    expect(typeof theme.border.muted).toBe("function");
    expect(typeof theme.border.focus).toBe("function");
  });

  it("returns an object with a priority property containing all required keys", () => {
    const theme = getTheme();
    expect(typeof theme.priority).toBe("object");
    expect(typeof theme.priority.high).toBe("function");
    expect(typeof theme.priority.medium).toBe("function");
    expect(typeof theme.priority.low).toBe("function");
    expect(typeof theme.priority.none).toBe("function");
  });

  it("returns an object with an assignee property containing all required keys", () => {
    const theme = getTheme();
    expect(typeof theme.assignee).toBe("object");
    expect(typeof theme.assignee.self).toBe("function");
    expect(typeof theme.assignee.others).toBe("function");
    expect(typeof theme.assignee.unassigned).toBe("function");
  });
});

describe("darkTheme text functions", () => {
  it("text.primary returns a string", () => {
    expect(typeof darkTheme.text.primary("hello")).toBe("string");
  });

  it("text.secondary returns a string", () => {
    expect(typeof darkTheme.text.secondary("hello")).toBe("string");
  });

  it("text.muted returns a string", () => {
    expect(typeof darkTheme.text.muted("hello")).toBe("string");
  });

  it("text.success returns a string", () => {
    expect(typeof darkTheme.text.success("hello")).toBe("string");
  });

  it("text.warning returns a string", () => {
    expect(typeof darkTheme.text.warning("hello")).toBe("string");
  });

  it("text.error returns a string", () => {
    expect(typeof darkTheme.text.error("hello")).toBe("string");
  });

  it("text.accent returns a string", () => {
    expect(typeof darkTheme.text.accent("hello")).toBe("string");
  });

  it("text functions include the input string in their output", () => {
    // chalk may strip ANSI codes in test environment, but the text must appear
    const input = "test-content";
    expect(darkTheme.text.primary(input)).toContain(input);
    expect(darkTheme.text.secondary(input)).toContain(input);
    expect(darkTheme.text.muted(input)).toContain(input);
    expect(darkTheme.text.success(input)).toContain(input);
    expect(darkTheme.text.warning(input)).toContain(input);
    expect(darkTheme.text.error(input)).toContain(input);
    expect(darkTheme.text.accent(input)).toContain(input);
  });
});

describe("darkTheme border functions", () => {
  it("border.primary returns a string", () => {
    expect(typeof darkTheme.border.primary("─")).toBe("string");
  });

  it("border.muted returns a string", () => {
    expect(typeof darkTheme.border.muted("─")).toBe("string");
  });

  it("border.focus returns a string", () => {
    expect(typeof darkTheme.border.focus("─")).toBe("string");
  });

  it("border functions include the input in their output", () => {
    const input = "━━━";
    expect(darkTheme.border.primary(input)).toContain(input);
    expect(darkTheme.border.muted(input)).toContain(input);
    expect(darkTheme.border.focus(input)).toContain(input);
  });
});

describe("darkTheme priority functions", () => {
  it("priority.high returns a string", () => {
    expect(typeof darkTheme.priority.high("[!]")).toBe("string");
  });

  it("priority.medium returns a string", () => {
    expect(typeof darkTheme.priority.medium("[~]")).toBe("string");
  });

  it("priority.low returns a string", () => {
    expect(typeof darkTheme.priority.low("[.]")).toBe("string");
  });

  it("priority.none returns a string", () => {
    expect(typeof darkTheme.priority.none("   ")).toBe("string");
  });

  it("priority functions include the input in their output", () => {
    const input = "[!]";
    expect(darkTheme.priority.high(input)).toContain(input);
    expect(darkTheme.priority.medium(input)).toContain(input);
    expect(darkTheme.priority.low(input)).toContain(input);
    expect(darkTheme.priority.none(input)).toContain(input);
  });
});

describe("darkTheme assignee functions", () => {
  it("assignee.self returns a string", () => {
    expect(typeof darkTheme.assignee.self("alice")).toBe("string");
  });

  it("assignee.others returns a string", () => {
    expect(typeof darkTheme.assignee.others("bob")).toBe("string");
  });

  it("assignee.unassigned returns a string", () => {
    expect(typeof darkTheme.assignee.unassigned("unassigned")).toBe("string");
  });

  it("assignee functions include the login in their output", () => {
    const login = "alice";
    expect(darkTheme.assignee.self(login)).toContain(login);
    expect(darkTheme.assignee.others(login)).toContain(login);
    expect(darkTheme.assignee.unassigned(login)).toContain(login);
  });
});

describe("Theme interface conformance", () => {
  it("darkTheme satisfies the Theme interface shape", () => {
    const theme: Theme = darkTheme;
    // Verify all function groups are present and callable
    expect(theme.text.primary("x")).toBeDefined();
    expect(theme.border.primary("x")).toBeDefined();
    expect(theme.priority.high("x")).toBeDefined();
    expect(theme.assignee.self("x")).toBeDefined();
  });
});
