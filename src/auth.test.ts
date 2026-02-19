import { beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeCodeForToken, getAuthorizationUrl } from "./auth.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("getAuthorizationUrl", () => {
  it("returns a URL starting with the TickTick authorize endpoint", () => {
    const url = getAuthorizationUrl("my-client-id");
    expect(url).toMatch(/^https:\/\/ticktick\.com\/oauth\/authorize/);
  });

  it("includes the client_id in the query string", () => {
    const url = getAuthorizationUrl("test-client-id");
    expect(url).toContain("client_id=test-client-id");
  });

  it("includes the required scope", () => {
    const url = getAuthorizationUrl("cid");
    expect(url).toContain("scope=tasks%3Awrite+tasks%3Aread");
  });

  it("includes response_type=code", () => {
    const url = getAuthorizationUrl("cid");
    expect(url).toContain("response_type=code");
  });

  it("includes state=hog", () => {
    const url = getAuthorizationUrl("cid");
    expect(url).toContain("state=hog");
  });

  it("includes the redirect_uri pointing to localhost:8080", () => {
    const url = getAuthorizationUrl("cid");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("localhost%3A8080");
  });

  it("produces a valid URL", () => {
    const url = getAuthorizationUrl("some-client");
    expect(() => new URL(url)).not.toThrow();
  });

  it("encodes special characters in the client id", () => {
    const url = getAuthorizationUrl("client id with spaces");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("client id with spaces");
  });

  it("different client IDs produce different URLs", () => {
    const urlA = getAuthorizationUrl("client-a");
    const urlB = getAuthorizationUrl("client-b");
    expect(urlA).not.toBe(urlB);
  });
});

describe("exchangeCodeForToken", () => {
  it("makes a POST request to the TickTick token endpoint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "abc123" }),
      text: () => Promise.resolve(""),
    });

    await exchangeCodeForToken("cid", "csec", "auth-code");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://ticktick.com/oauth/token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends Basic auth header with base64-encoded credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok" }),
    });

    await exchangeCodeForToken("myId", "mySecret", "code");

    const expectedCredentials = Buffer.from("myId:mySecret").toString("base64");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${expectedCredentials}`,
        }),
      }),
    );
  });

  it("sends Content-Type application/x-www-form-urlencoded", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok" }),
    });

    await exchangeCodeForToken("cid", "csec", "code");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
  });

  it("sends grant_type, code, and redirect_uri in the body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok" }),
    });

    await exchangeCodeForToken("cid", "csec", "my-auth-code");

    const callBody = mockFetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(callBody.get("grant_type")).toBe("authorization_code");
    expect(callBody.get("code")).toBe("my-auth-code");
    expect(callBody.get("redirect_uri")).toBe("http://localhost:8080");
  });

  it("returns the access token from the response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "returned-token-value" }),
    });

    const token = await exchangeCodeForToken("cid", "csec", "code");

    expect(token).toBe("returned-token-value");
  });

  it("throws when the response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve("invalid_grant"),
    });

    await expect(exchangeCodeForToken("cid", "csec", "bad-code")).rejects.toThrow(
      "Token exchange failed: invalid_grant",
    );
  });

  it("throws with the server error message on failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      text: () => Promise.resolve('{"error":"access_denied"}'),
    });

    await expect(exchangeCodeForToken("cid", "csec", "code")).rejects.toThrow(
      'Token exchange failed: {"error":"access_denied"}',
    );
  });

  it("passes the authorization code through unchanged", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok" }),
    });

    await exchangeCodeForToken("cid", "csec", "my-very-specific-code-12345");

    const callBody = mockFetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(callBody.get("code")).toBe("my-very-specific-code-12345");
  });

  it("colon in clientId and clientSecret is encoded correctly in Basic auth", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "tok" }),
    });

    // clientSecret contains a colon — only the first colon separates id from secret
    await exchangeCodeForToken("id", "sec:ret", "code");

    const expectedCredentials = Buffer.from("id:sec:ret").toString("base64");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${expectedCredentials}`,
        }),
      }),
    );
  });
});

// waitForAuthCode is tested separately in src/auth-wait.test.ts using a
// mocked node:http to avoid real port 8080 binding conflicts.
