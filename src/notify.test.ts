import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUnref = vi.fn();
const mockSpawn = vi.fn(() => ({ unref: mockUnref }));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

const { sendOsNotification, sendSoundNotification, notify } = await import("./notify.js");

describe("sendOsNotification", () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    mockUnref.mockClear();
  });

  it("should call osascript on darwin with safe variable binding", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    sendOsNotification({ title: "Test Title", body: "Test Body" });

    expect(mockSpawn).toHaveBeenCalledWith(
      "osascript",
      [
        "-e",
        `set theBody to ${JSON.stringify("Test Body")}`,
        "-e",
        `set theTitle to ${JSON.stringify("Test Title")}`,
        "-e",
        "display notification theBody with title theTitle",
      ],
      { stdio: "ignore", detached: true },
    );
    expect(mockUnref).toHaveBeenCalled();

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should safely handle quotes and special characters in title and body on darwin", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    sendOsNotification({ title: 'Say "hello"', body: 'It\'s "done"' });

    expect(mockSpawn).toHaveBeenCalledWith(
      "osascript",
      [
        "-e",
        `set theBody to ${JSON.stringify('It\'s "done"')}`,
        "-e",
        `set theTitle to ${JSON.stringify('Say "hello"')}`,
        "-e",
        "display notification theBody with title theTitle",
      ],
      { stdio: "ignore", detached: true },
    );

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should call notify-send on linux", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    sendOsNotification({ title: "Test", body: "Body" });

    expect(mockSpawn).toHaveBeenCalledWith("notify-send", ["Test", "Body"], {
      stdio: "ignore",
      detached: true,
    });
    expect(mockUnref).toHaveBeenCalled();

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
    mockSpawn.mockClear();
    mockUnref.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should do nothing when config is undefined", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    notify(undefined, { title: "t", body: "b" });
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("should send OS notification when os is true", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    notify({ os: true, sound: false }, { title: "Done", body: "Agent finished" });
    expect(mockSpawn).toHaveBeenCalledOnce();

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("should send sound notification when sound is true", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    notify({ os: false, sound: true }, { title: "Done", body: "Agent finished" });
    expect(writeSpy).toHaveBeenCalledWith("\x07");
    expect(mockSpawn).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("should send both when both are true", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    notify({ os: true, sound: true }, { title: "Done", body: "Agent finished" });
    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalledWith("\x07");

    writeSpy.mockRestore();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});
