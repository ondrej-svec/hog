/**
 * Returns the clipboard command args for the current platform/environment,
 * or null if no clipboard tool is available.
 *
 * Detection order: WSL → Wayland → X11 → macOS/Windows → null
 */
export function getClipboardArgs(): readonly string[] | null {
  if (process.platform === "darwin") return ["pbcopy"] as const;
  if (process.platform === "win32") return ["clip"] as const;
  // WSL: check both vars — WSL_DISTRO_NAME is unset for root users
  if (process.env["WSL_DISTRO_NAME"] ?? process.env["WSL_INTEROP"]) return ["clip.exe"] as const;
  // Wayland before X11 (wl-copy, not xclip which has a pipe-hang bug)
  if (process.env["WAYLAND_DISPLAY"]) return ["wl-copy"] as const;
  // X11: use xsel (NOT xclip — known pipe-hang bug when no clipboard manager)
  if (process.env["DISPLAY"]) return ["xsel", "--clipboard", "--input"] as const;
  return null;
}
