import type { Instance } from "ink";

let inkInstance: Instance | null = null;

/** Store the Ink render instance for use in editor integration ($EDITOR launch). */
export function setInkInstance(instance: Instance): void {
  inkInstance = instance;
}

export function getInkInstance(): Instance | null {
  return inkInstance;
}
