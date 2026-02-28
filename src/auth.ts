import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const AUTH_URL = "https://ticktick.com/oauth/authorize";
const TOKEN_URL = "https://ticktick.com/oauth/token";
const REDIRECT_URI = "http://localhost:8080";
const SCOPE = "tasks:write tasks:read";

export interface AuthorizationUrlResult {
  url: string;
  state: string;
}

export function getAuthorizationUrl(clientId: string): AuthorizationUrlResult {
  const oauthState = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    scope: SCOPE,
    client_id: clientId,
    state: oauthState,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
  });
  return { url: `${AUTH_URL}?${params}`, state: oauthState };
}

export async function waitForAuthCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (returnedState !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid OAuth state");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Heart of Gold authenticated!</h1><p>You can close this window.</p></body></html>",
        );
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing authorization code");
        server.close();
        reject(new Error("No authorization code received"));
      }
    });

    server.listen(8080, "127.0.0.1", () => {
      // Server ready, waiting for redirect on localhost only
    });

    server.on("error", reject);

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out (2 min)"));
    }, 120_000);
  });
}

export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}
