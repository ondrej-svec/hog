/**
 * Parse $EDITOR/$VISUAL into command + args, handling basic quoting.
 * Supports:
 *   vi                       → { cmd: "vi", args: [] }
 *   code --wait              → { cmd: "code", args: ["--wait"] }
 *   "/path to/editor" --wait → { cmd: "/path to/editor", args: ["--wait"] }
 *   'my editor'              → { cmd: "my editor", args: [] }
 */
export function parseEditorCommand(editorEnv: string): { cmd: string; args: string[] } | null {
  const tokens: string[] = [];
  let i = 0;
  const len = editorEnv.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && (editorEnv[i] === " " || editorEnv[i] === "\t")) i++;
    if (i >= len) break;

    const quote = editorEnv[i];
    if (quote === '"' || quote === "'") {
      // Quoted token — find matching close quote
      const end = editorEnv.indexOf(quote, i + 1);
      if (end === -1) {
        // Unmatched quote — take the rest as-is (minus the opening quote)
        tokens.push(editorEnv.slice(i + 1));
        break;
      }
      tokens.push(editorEnv.slice(i + 1, end));
      i = end + 1;
    } else {
      // Unquoted token — read until whitespace
      const start = i;
      while (i < len && editorEnv[i] !== " " && editorEnv[i] !== "\t") i++;
      tokens.push(editorEnv.slice(start, i));
    }
  }

  const cmd = tokens[0];
  if (!cmd) return null;
  return { cmd, args: tokens.slice(1) };
}

/** Resolve the user's preferred editor command from environment variables. */
export function resolveEditor(): { cmd: string; args: string[] } | null {
  const editorEnv = process.env["VISUAL"] ?? process.env["EDITOR"] ?? "vi";
  return parseEditorCommand(editorEnv);
}
