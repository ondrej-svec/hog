import { render } from "ink";
import type { ReactNode } from "react";
import { Component } from "react";
import type { HogConfig } from "../config.js";
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
