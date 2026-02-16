import { render } from "ink";
import type { HogConfig } from "../config.js";
import { Dashboard } from "./components/dashboard.js";
import type { FetchOptions } from "./fetch.js";

export async function runLiveDashboard(
  config: HogConfig,
  options: FetchOptions,
  activeProfile?: string | null,
): Promise<void> {
  const { waitUntilExit } = render(
    <Dashboard config={config} options={options} activeProfile={activeProfile ?? null} />,
  );

  await waitUntilExit();
}
