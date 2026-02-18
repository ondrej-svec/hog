import type { Instance } from "ink";

let _instance: Instance | null = null;

/** Store the Ink render instance for use in editor integration ($EDITOR launch). */
export function setInkInstance(instance: Instance): void {
  _instance = instance;
}

export function getInkInstance(): Instance | null {
  return _instance;
}
