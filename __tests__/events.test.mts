import { describe, it, expect, vi, afterEach } from "vitest";
import { valkeyEvents, emitValkeyEvent } from "../events.mts";
import * as errorsModule from "../errors.mts";

describe("events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("valkeyEvents", () => {
    it("should allow subscribing to and receiving events", () => {
      const listenerSpy = vi.fn();
      valkeyEvents.on("cache:invalidate", listenerSpy);

      valkeyEvents.emit("cache:invalidate", { cacheName: "test-cache" });

      expect(listenerSpy).toHaveBeenCalledTimes(1);
      expect(listenerSpy).toHaveBeenCalledWith({ cacheName: "test-cache" });

      valkeyEvents.off("cache:invalidate", listenerSpy);
    });

    it("should allow unsubscribing from events", () => {
      const listenerSpy = vi.fn();
      valkeyEvents.on("cache:invalidate", listenerSpy);
      valkeyEvents.off("cache:invalidate", listenerSpy);

      valkeyEvents.emit("cache:invalidate", { cacheName: "test-cache" });

      expect(listenerSpy).not.toHaveBeenCalled();
    });

    it("should have max listeners set correctly in test environment", () => {
      expect(valkeyEvents.getMaxListeners()).toBe(1000);
    });
  });

  describe("emitValkeyEvent", () => {
    it("should emit an event successfully", () => {
      const emitSpy = vi.spyOn(valkeyEvents, "emit");
      const eventArg = { cacheName: "test-cache", keys: ["key1"] };

      emitValkeyEvent("cache:set", eventArg);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(emitSpy).toHaveBeenCalledWith("cache:set", eventArg);
    });

    it("should trigger registered listeners with correct arguments", () => {
      const listenerSpy = vi.fn();
      valkeyEvents.on("cache:set", listenerSpy);

      const eventArg = { cacheName: "test-cache", keys: ["key1"] };
      emitValkeyEvent("cache:set", eventArg);

      expect(listenerSpy).toHaveBeenCalledTimes(1);
      expect(listenerSpy).toHaveBeenCalledWith(eventArg);

      // Clean up the listener so it doesn't affect other tests
      valkeyEvents.off("cache:set", listenerSpy);
    });

    it("should handle error during emit and call handleValkeyError", () => {
      const error = new Error("Emit failed");
      const emitSpy = vi.spyOn(valkeyEvents, "emit").mockImplementation(() => {
        throw error;
      });
      const handleValkeyErrorSpy = vi
        .spyOn(errorsModule, "handleValkeyError")
        .mockImplementation(() => {});

      const eventArg = { cacheName: "test-cache", keys: ["key1"] };

      emitValkeyEvent("cache:set", eventArg);

      expect(emitSpy).toHaveBeenCalledTimes(1);
      expect(handleValkeyErrorSpy).toHaveBeenCalledTimes(1);
      expect(handleValkeyErrorSpy).toHaveBeenCalledWith(error);
    });
  });
});
