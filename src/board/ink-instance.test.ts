import { describe, expect, it } from "vitest";
import { getInkInstance, setInkInstance } from "./ink-instance.js";

describe("ink-instance", () => {
  it("getInkInstance returns the value set by setInkInstance", () => {
    const fakeInstance = { id: "test" } as unknown as Parameters<typeof setInkInstance>[0];
    setInkInstance(fakeInstance);
    expect(getInkInstance()).toBe(fakeInstance);
  });
});
