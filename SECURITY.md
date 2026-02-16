# Security Policy

## Trust Model

hog is a **local CLI tool** that runs on your machine. It interacts with:

- **GitHub** via the `gh` CLI (inherits your `gh auth` session)
- **TickTick API** via OAuth tokens stored at `~/.config/hog/auth.json` with `0o600` permissions
- **Local filesystem** for configuration at `~/.config/hog/`

hog does **not** run a server, accept network connections, or process untrusted input from external sources.

### What hog protects against

- **Shell injection**: All external process calls use `execFileSync` (no shell interpolation)
- **Input validation**: User inputs validated with Zod schemas and regex patterns
- **Token permissions**: Auth tokens stored with owner-only read/write (`0o600`)

### What hog does NOT protect against

- **Local filesystem compromise**: If an attacker has access to your filesystem, they can read your tokens regardless of file permissions
- **Compromised `gh` CLI**: hog trusts the `gh` binary on your PATH

## Reporting a Vulnerability

If you find a security issue, please report it responsibly:

1. **Do NOT open a public issue**
2. Email **ondrej@svec.dev** with details
3. Include steps to reproduce if possible
4. You'll receive a response within 48 hours

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |
