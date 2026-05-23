import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("scripts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getExitHandler(processOnceSpy: ReturnType<typeof vi.spyOn>) {
    return (
      processOnceSpy.mock.calls.find((call: [string, ...unknown[]]) => call[0] === "exit")?.[1] ??
      (() => {
        throw new Error("Expected exit handler to be registered");
      })()
    );
  }

  it("registerScript registers an exit hook and pushes the script", async () => {
    const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

    const { registerScript } = await import("../scripts.mts");
    const script = registerScript("return 1");
    expect(processOnceSpy).toHaveBeenCalledWith("exit", expect.any(Function));

    const exitHandler = getExitHandler(processOnceSpy);

    const releaseSpy = vi.spyOn(script, "release");
    try {
      exitHandler();
      expect(releaseSpy).toHaveBeenCalled();
    } finally {
      releaseSpy.mockRestore();
      script.release();
    }
  });

  it("registerScript ignores script.release() errors in the exit hook", async () => {
    const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

    const { registerScript } = await import("../scripts.mts");
    const script = registerScript("return 1");

    const exitHandler = getExitHandler(processOnceSpy);

    const releaseSpy = vi.spyOn(script, "release").mockImplementation(() => {
      throw new Error("Release failed");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => exitHandler()).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));

    releaseSpy.mockRestore();
    script.release();
  });

  it("registerScript registers the exit hook only once", async () => {
    const processOnceSpy = vi.spyOn(process, "once").mockImplementation(() => process);

    const { registerScript } = await import("../scripts.mts");
    const script1 = registerScript("return 1");
    const script2 = registerScript("return 2");

    expect(processOnceSpy).toHaveBeenCalledTimes(1);

    script1.release();
    script2.release();
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
