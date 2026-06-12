import { describe, it, expect, vi, afterEach } from "vitest";
import { setValkeyErrorHandler, handleValkeyError, type ValkeyErrorHandler } from "../errors.mts";

describe("errors.mts", () => {
  afterEach(() => {
    // Reset global error handler state back to initial state (no-op)
    setValkeyErrorHandler(() => {});
  });

  describe("setValkeyErrorHandler", () => {
    it("should successfully replace the global error handler", () => {
      const mockHandler1 = vi.fn<ValkeyErrorHandler>();
      const mockHandler2 = vi.fn<ValkeyErrorHandler>();

      setValkeyErrorHandler(mockHandler1);
      handleValkeyError(new Error("Test 1"));

      expect(mockHandler1).toHaveBeenCalledTimes(1);
      expect(mockHandler2).not.toHaveBeenCalled();

      setValkeyErrorHandler(mockHandler2);
      handleValkeyError(new Error("Test 2"));

      expect(mockHandler1).toHaveBeenCalledTimes(1);
      expect(mockHandler2).toHaveBeenCalledTimes(1);
    });

    it("should accept a no-op function", () => {
      expect(() => {
        setValkeyErrorHandler(() => {});
        handleValkeyError(new Error("Test"));
      }).not.toThrow();
    });
  });

  describe("handleValkeyError", () => {
    it("should call the provided handler when an Error instance is passed", () => {
      const mockHandler = vi.fn<ValkeyErrorHandler>();
      setValkeyErrorHandler(mockHandler);

      const testError = new Error("Test error");
      handleValkeyError(testError);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(testError);
    });

    it("should normalize and call the provided handler when a generic type is passed", () => {
      const mockHandler = vi.fn<ValkeyErrorHandler>();
      setValkeyErrorHandler(mockHandler);

      const testString = "This is a generic error string";
      handleValkeyError(testString);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(mockHandler.mock.calls[0]![0].message).toBe(testString);
    });

    it("should correctly handle numeric errors", () => {
      const mockHandler = vi.fn<ValkeyErrorHandler>();
      setValkeyErrorHandler(mockHandler);

      const testNumber = 404;
      handleValkeyError(testNumber);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(mockHandler.mock.calls[0]![0].message).toBe("404");
    });

    it("should correctly handle object errors", () => {
      const mockHandler = vi.fn<ValkeyErrorHandler>();
      setValkeyErrorHandler(mockHandler);

      const testObj = { custom: "error" };
      handleValkeyError(testObj);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(mockHandler.mock.calls[0]![0].message).toBe("[object Object]");
    });
  });
});
