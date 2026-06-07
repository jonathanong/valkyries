import { describe, it, expect, vi, afterEach } from "vitest";
import { valkeyEvents, emitValkeyEvent } from "../events.mts";
import * as errorsModule from "../errors.mts";

describe("events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("emitValkeyEvent", () => {
    it("should emit an event successfully", () => {
      const emitSpy = vi.spyOn(valkeyEvents, "emit");
      const eventArgs = [{ cacheName: "test-cache", keys: ["key1"] }];

      emitValkeyEvent("cache:set", ...eventArgs);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith("cache:set", ...eventArgs);
    });

    it("should handle error during emit and call handleValkeyError", () => {
      const error = new Error("Emit failed");
      const emitSpy = vi.spyOn(valkeyEvents, "emit").mockImplementation(() => {
        throw error;
      });
      const handleValkeyErrorSpy = vi.spyOn(errorsModule, "handleValkeyError").mockImplementation(() => {});

      const eventArgs = [{ cacheName: "test-cache", keys: ["key1"] }];

      emitValkeyEvent("cache:set", ...eventArgs);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(handleValkeyErrorSpy).toHaveBeenCalledTimes(1);
      expect(handleValkeyErrorSpy).toHaveBeenCalledWith(error);
    });
  });
});
