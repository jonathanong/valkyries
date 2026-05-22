import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("scripts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registerScript registers an exit hook and pushes the script", async () => {
    const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

    const { registerScript } = await import("../scripts.mts");
    const script = registerScript("return 1");
    expect(processOnceSpy).toHaveBeenCalledWith("exit", expect.any(Function));

    const exitHandler = processOnceSpy.mock.calls[0][1];

    const releaseSpy = vi.spyOn(script, "release");
    exitHandler();
    expect(releaseSpy).toHaveBeenCalled();
  });

  it("registerScript ignores script.release() errors in the exit hook", async () => {
    const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

    const { registerScript } = await import("../scripts.mts");
    const script = registerScript("return 1");

    const exitHandler = processOnceSpy.mock.calls[0][1];

    vi.spyOn(script, "release").mockImplementation(() => {
      throw new Error("Release failed");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => exitHandler()).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
  });

  it("registerScript registers the exit hook only once", async () => {
    const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

    const { registerScript } = await import("../scripts.mts");
    registerScript("return 1");
    registerScript("return 2");

    expect(processOnceSpy).toHaveBeenCalledTimes(1);
  });

  it("loadScript constructs the correct URL and reads the file", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.readFileSync).mockReturnValue("return 2");

    const { loadScript } = await import("../scripts.mts");
    const result = loadScript("test.lua", "file:///app/");

    expect(fs.readFileSync).toHaveBeenCalledWith(new URL("file:///app/scripts/test.lua"), "utf8");
    expect(result).toBe("return 2");
  });
});
