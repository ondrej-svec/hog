import { render } from "ink";
import type { ReactNode } from "react";
import { Component } from "react";
import type { HogConfig } from "../config.js";
import { Cockpit } from "./components/cockpit.js";
import { Dashboard } from "./components/dashboard.js";
import type { FetchOptions } from "./fetch.js";
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
  const instance = render(
    <InkErrorBoundary>
      <Cockpit config={config} />
    </InkErrorBoundary>,
  );
  setInkInstance(instance);
  await instance.waitUntilExit();
}

/** Launch the full dashboard TUI (v1 legacy — will be removed). */
export async function runLiveDashboard(
  config: HogConfig,
  options: FetchOptions,
  activeProfile?: string | null,
): Promise<void> {
  const instance = render(
    <InkErrorBoundary>
      <Dashboard config={config} options={options} activeProfile={activeProfile ?? null} />
    </InkErrorBoundary>,
  );
  setInkInstance(instance);

  await instance.waitUntilExit();
}
