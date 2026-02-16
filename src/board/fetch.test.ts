import { describe, expect, it } from "vitest";
import { extractSlackUrl, SLACK_URL_RE } from "./fetch.js";

describe("SLACK_URL_RE", () => {
  it("should match standard Slack archive URLs", () => {
    const url = "https://team.slack.com/archives/C01234567/p1234567890";
    expect(SLACK_URL_RE.test(url)).toBe(true);
  });

  it("should match Slack URLs with various workspace names", () => {
    const url = "https://my-company.slack.com/archives/C0ABCDEFG/p9876543210";
    expect(SLACK_URL_RE.test(url)).toBe(true);
  });

  it("should not match non-Slack URLs", () => {
    expect(SLACK_URL_RE.test("https://github.com/owner/repo")).toBe(false);
    expect(SLACK_URL_RE.test("https://google.com")).toBe(false);
  });

  it("should not match Slack URLs without archive path", () => {
    expect(SLACK_URL_RE.test("https://team.slack.com/messages")).toBe(false);
  });
});

describe("extractSlackUrl", () => {
  it("should extract Slack URL from issue body", () => {
    const body = "See discussion: https://team.slack.com/archives/C01234567/p1234567890";
    expect(extractSlackUrl(body)).toBe("https://team.slack.com/archives/C01234567/p1234567890");
  });

  it("should return first Slack URL when multiple are present", () => {
    const body = [
      "Thread 1: https://team.slack.com/archives/C01234567/p1111111111",
      "Thread 2: https://team.slack.com/archives/C09876543/p2222222222",
    ].join("\n");
    expect(extractSlackUrl(body)).toBe("https://team.slack.com/archives/C01234567/p1111111111");
  });

  it("should return undefined for body with no Slack URLs", () => {
    expect(extractSlackUrl("Just a regular issue body")).toBeUndefined();
  });

  it("should return undefined for empty body", () => {
    expect(extractSlackUrl("")).toBeUndefined();
  });

  it("should return undefined for undefined body", () => {
    expect(extractSlackUrl(undefined)).toBeUndefined();
  });

  it("should extract URL embedded in markdown", () => {
    const body =
      "Check [this thread](https://team.slack.com/archives/C01234567/p1234567890) for context";
    expect(extractSlackUrl(body)).toBe("https://team.slack.com/archives/C01234567/p1234567890");
  });

  it("should handle Slack URL with lowercase channel ID", () => {
    // The regex is case-insensitive
    const body = "https://team.slack.com/archives/c01234567/p1234567890";
    expect(extractSlackUrl(body)).toBe("https://team.slack.com/archives/c01234567/p1234567890");
  });
});
