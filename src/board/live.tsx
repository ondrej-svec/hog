import { render } from "ink";
import type { HogConfig } from "../config.js";
import { setInkInstance } from "./ink-instance.js";
import { Dashboard } from "./components/dashboard.js";
import type { FetchOptions } from "./fetch.js";

export async function runLiveDashboard(
  config: HogConfig,
  options: FetchOptions,
  activeProfile?: string | null,
): Promise<void> {
  const instance = render(
    <Dashboard config={config} options={options} activeProfile={activeProfile ?? null} />,
  );
  setInkInstance(instance);

  await instance.waitUntilExit();
}
