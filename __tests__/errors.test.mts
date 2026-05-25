import { describe, it, expect, vi, afterEach } from "vitest";
import { setValkeyErrorHandler, handleValkeyError } from "../errors.mts";

describe("errors.mts", () => {
  // Since errors.mts exports these but the default handler is private to the module,
  // we can only reset it by keeping a dummy or re-setting it to a no-op if we don't have access.
  // Actually, we can just replace the handler and verify it.

  afterEach(() => {
    // Reset to a no-op handler after each test to prevent side effects in other tests
    setValkeyErrorHandler(() => {});
  });

  it("should set and call a custom error handler with an Error instance", () => {
    const mockHandler = vi.fn();
    setValkeyErrorHandler(mockHandler);

    const error = new Error("Test error");
    handleValkeyError(error);

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith(error);
  });

  it("should normalize string error into an Error instance", () => {
    const mockHandler = vi.fn();
    setValkeyErrorHandler(mockHandler);

    handleValkeyError("String error");

    expect(mockHandler).toHaveBeenCalledTimes(1);
    const passedError = mockHandler.mock.calls[0][0];
    expect(passedError).toBeInstanceOf(Error);
    expect(passedError.message).toBe("String error");
  });

  it("should normalize object error into an Error instance", () => {
    const mockHandler = vi.fn();
    setValkeyErrorHandler(mockHandler);

    const objError = { reason: "Bad config" };
    handleValkeyError(objError);

    expect(mockHandler).toHaveBeenCalledTimes(1);
    const passedError = mockHandler.mock.calls[0][0];
    expect(passedError).toBeInstanceOf(Error);
    expect(passedError.message).toBe("[object Object]");
  });
});
