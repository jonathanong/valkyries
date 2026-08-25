import { describe, expect, it, vi } from "vitest";
import {
  assertChannelPart,
  decrement,
  deliver,
  glideStringToString,
  removeHandler,
  toError,
} from "../channel-pubsub-internals.mts";

describe("channel pub/sub internals", () => {
  it("updates counters and handlers without leaving empty entries", () => {
    const counts = new Map<string, number>([["one", 2]]);
    decrement(counts, "one");
    decrement(counts, "one");
    decrement(counts, "missing");

    const handler = vi.fn<(value: string) => void>();
    const handlers = new Map<string, Set<(value: string) => void>>([["one", new Set([handler])]]);
    removeHandler(handlers, "missing", handler);
    removeHandler(handlers, "one", handler);

    expect(counts).toEqual(new Map());
    expect(handlers).toEqual(new Map());
  });

  it("normalizes errors and Glide strings", () => {
    expect(toError(new Error("known")).message).toBe("known");
    expect(toError("unknown").message).toBe("unknown");
    expect(glideStringToString("text")).toBe("text");
    expect(glideStringToString(Buffer.from("bytes"))).toBe("bytes");
  });

  it("validates channel parts and isolates callbacks", () => {
    expect(() => assertChannelPart("key", "one")).not.toThrow();
    expect(() => assertChannelPart("key", "")).toThrow();
    expect(() => assertChannelPart("key", "one*")).toThrow();
    const onError = vi.fn();
    deliver(
      () => {
        throw "failure";
      },
      "value",
      onError,
    );

    expect(onError).toHaveBeenCalledWith("failure");
  });
});
