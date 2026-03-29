import { render } from "ink";
import type { ReactNode } from "react";
import { Component } from "react";
import type { HogConfig } from "../config.js";
import { Cockpit } from "./components/cockpit.js";
import { setInkInstance } from "./ink-instance.js";

class InkErrorBoundary extends Component<
  { readonly children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      process.stderr.write(`hog: fatal render error: ${this.state.error.message}\n`);
      process.exit(1);
    }
    return this.props.children;
  }
}

/** Launch the pipeline cockpit TUI (v2 primary). */
export async function runCockpit(config: HogConfig): Promise<void> {
  // Auto-start daemon if not running
  const { ensureDaemonRunning } = await import("../daemon/ensure-daemon.js");
  const daemonReady = await ensureDaemonRunning();
  if (!daemonReady) {
    process.stderr.write(
      "Warning: could not start hogd daemon. Cockpit will have limited functionality.\n",
    );
  }

  // Enter alternate screen buffer (like lazygit, vim, etc.)
  process.stdout.write("\x1b[?1049h");
  // Hide cursor
  process.stdout.write("\x1b[?25l");

  const instance = render(
    <InkErrorBoundary>
      <Cockpit config={config} />
    </InkErrorBoundary>,
  );
  setInkInstance(instance);
  await instance.waitUntilExit();

  // Show cursor
  process.stdout.write("\x1b[?25h");
  // Leave alternate screen buffer — restores previous terminal content
  process.stdout.write("\x1b[?1049l");
}

/** @deprecated Use runCockpit instead. Kept for backward compat during migration. */
export async function runLiveDashboard(config: HogConfig): Promise<void> {
  return runCockpit(config);
}
