import { afterEach, describe, expect, it } from "vitest";
import { getClipboardArgs } from "./clipboard.js";

describe("getClipboardArgs", () => {
  const origPlatform = process.platform;
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    for (const key of ["WSL_DISTRO_NAME", "WSL_INTEROP", "WAYLAND_DISPLAY", "DISPLAY"]) {
      if (origEnv[key] !== undefined) {
        process.env[key] = origEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns pbcopy on darwin", () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    expect(getClipboardArgs()).toEqual(["pbcopy"]);
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("returns clip on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    expect(getClipboardArgs()).toEqual(["clip"]);
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("returns null when no display available (linux headless)", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    delete process.env["WSL_DISTRO_NAME"];
    delete process.env["WSL_INTEROP"];
    delete process.env["WAYLAND_DISPLAY"];
    delete process.env["DISPLAY"];
    expect(getClipboardArgs()).toBeNull();
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("returns wl-copy on Wayland", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    delete process.env["WSL_DISTRO_NAME"];
    delete process.env["WSL_INTEROP"];
    process.env["WAYLAND_DISPLAY"] = "wayland-0";
    delete process.env["DISPLAY"];
    expect(getClipboardArgs()).toEqual(["wl-copy"]);
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });

  it("returns xsel on X11", () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    delete process.env["WSL_DISTRO_NAME"];
    delete process.env["WSL_INTEROP"];
    delete process.env["WAYLAND_DISPLAY"];
    process.env["DISPLAY"] = ":0";
    expect(getClipboardArgs()).toEqual(["xsel", "--clipboard", "--input"]);
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  });
});
