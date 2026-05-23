import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEmitValkeyEvent } = vi.hoisted(() => ({
  mockEmitValkeyEvent: vi.fn(),
}));

vi.mock("../events.mts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../events.mts")>();
  return {
    ...mod,
    emitValkeyEvent: mockEmitValkeyEvent,
  };
});

import { trackCacheCall } from "../cache-metrics.mts";

describe("cache-metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits cache:call event with correct data", () => {
    trackCacheCall({
      cacheName: "my-cache",
      batch: true,
      hits: 10,
      misses: 2,
      bloomMisses: 1,
      duration: 123.4,
    });

    expect(mockEmitValkeyEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitValkeyEvent).toHaveBeenCalledWith("cache:call", {
      cacheName: "my-cache",
      batch: true,
      hits: 10,
      misses: 2,
      bloomMisses: 1,
      durationMs: 123.4,
    });
  });
});
