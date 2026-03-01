import type { SpawnSyncReturns } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const { spawnSync } = await import("node:child_process");
const mockedSpawnSync = vi.mocked(spawnSync);

const { sendOsNotification, sendSoundNotification, notify } = await import("./notify.js");

describe("sendOsNotification", () => {
  beforeEach(() => {
    mockedSpawnSync.mockReset();
  });

  it("should call osascript on darwin", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    sendOsNotification({ title: "Test Title", body: "Test Body" });

    expect(mockedSpawnSync).toHaveBeenCalledWith("osascript", [
      "-e",
      'display notification "Test Body" with title "Test Title"',
    ]);

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should escape double quotes in title and body on darwin", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    sendOsNotification({ title: 'Say "hello"', body: 'It\'s "done"' });

    expect(mockedSpawnSync).toHaveBeenCalledWith("osascript", [
      "-e",
      'display notification "It\'s \\"done\\"" with title "Say \\"hello\\""',
    ]);

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should call notify-send on linux", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    sendOsNotification({ title: "Test", body: "Body" });

    expect(mockedSpawnSync).toHaveBeenCalledWith("notify-send", ["Test", "Body"]);

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});

describe("sendSoundNotification", () => {
  it("should write bell character to stdout", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    sendSoundNotification();
    expect(writeSpy).toHaveBeenCalledWith("\x07");
    writeSpy.mockRestore();
  });
});

describe("notify", () => {
  beforeEach(() => {
    mockedSpawnSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should do nothing when config is undefined", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    notify(undefined, { title: "t", body: "b" });
    expect(mockedSpawnSync).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("should send OS notification when os is true", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    notify({ os: true, sound: false }, { title: "Done", body: "Agent finished" });
    expect(mockedSpawnSync).toHaveBeenCalledOnce();

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should send sound notification when sound is true", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    notify({ os: false, sound: true }, { title: "Done", body: "Agent finished" });
    expect(writeSpy).toHaveBeenCalledWith("\x07");
    expect(mockedSpawnSync).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("should send both when both are true", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    notify({ os: true, sound: true }, { title: "Done", body: "Agent finished" });
    expect(mockedSpawnSync).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledWith("\x07");

    writeSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});
