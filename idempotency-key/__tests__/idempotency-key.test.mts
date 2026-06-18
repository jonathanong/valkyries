import { describe, expect, it, vi } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";
import {
  completeIdempotencyKey,
  getAndDelete,
  releaseIdempotencyKey,
  reserveIdempotencyKey,
} from "../../idempotency-key.mts";
import { Decoder, type GlideClient } from "@valkey/valkey-glide";

let unique = 0;
const rand = () => {
  unique += 1;
  return unique.toString(36);
};

describe("idempotency-key", () => {
  it("getAndDelete atomically returns and deletes values", async () => {
    const key = `consume-once:{${rand()}}`;
    try {
      await cacheValkeyClient.set(key, "challenge");

      await expect(getAndDelete(key)).resolves.toBe("challenge");
      await expect(getAndDelete(key)).resolves.toBeNull();
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("getAndDelete uses native GETDEL with the provided client", async () => {
    const customCommand = vi.fn<GlideClient["customCommand"]>().mockResolvedValue("value");
    const client = { customCommand } as unknown as GlideClient;

    await expect(getAndDelete("consume-once:key", { client })).resolves.toBe("value");

    expect(customCommand).toHaveBeenCalledWith(["GETDEL", "consume-once:key"], {
      decoder: Decoder.String,
    });
  });
  it("getAndDelete stringifies various valkey result types", async () => {
    const customCommand = vi.fn<GlideClient["customCommand"]>();
    const client = { customCommand } as unknown as GlideClient;

    customCommand.mockResolvedValueOnce(123);
    await expect(getAndDelete("key", { client })).resolves.toBe("123");

    customCommand.mockResolvedValueOnce(123n);
    await expect(getAndDelete("key", { client })).resolves.toBe("123");

    customCommand.mockResolvedValueOnce(true);
    await expect(getAndDelete("key", { client })).resolves.toBe("true");

    customCommand.mockResolvedValueOnce({ complex: "object" });
    await expect(getAndDelete("key", { client })).resolves.toBe('{"complex":"object"}');

    customCommand.mockResolvedValueOnce((() => {}) as any);
    await expect(getAndDelete("key", { client })).resolves.toBe("[unserializable]");
  });

  it("reserves once and allows reuse after release", async () => {
    const key = `idempotency:{${rand()}}`;
    try {
      const reservation = await reserveIdempotencyKey(key, 60);
      expect(reservation.state).toBe("reserved");
      if (reservation.state !== "reserved") throw new Error("reservation failed");

      await expect(reserveIdempotencyKey(key, 60)).resolves.toEqual({ state: "processing" });
      await expect(releaseIdempotencyKey(key, reservation.token)).resolves.toBe(true);

      const next = await reserveIdempotencyKey(key, 60);
      expect(next.state).toBe("reserved");
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("treats same-token reservation retries as reserved", async () => {
    const key = `idempotency:{${rand()}}`;
    try {
      await expect(reserveIdempotencyKey(key, 60, { token: "token-1" })).resolves.toEqual({
        state: "reserved",
        token: "token-1",
      });
      await expect(reserveIdempotencyKey(key, 60, { token: "token-1" })).resolves.toEqual({
        state: "reserved",
        token: "token-1",
      });
      await expect(reserveIdempotencyKey(key, 60, { token: "token-2" })).resolves.toEqual({
        state: "processing",
      });
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("returns completed for duplicate keys after completion", async () => {
    const key = `idempotency:{${rand()}}`;
    try {
      const reservation = await reserveIdempotencyKey(key, 60);
      expect(reservation.state).toBe("reserved");
      if (reservation.state !== "reserved") throw new Error("reservation failed");

      await expect(completeIdempotencyKey(key, reservation.token, 60)).resolves.toBe("completed");
      await expect(completeIdempotencyKey(key, reservation.token, 60)).resolves.toBe("completed");
      await expect(reserveIdempotencyKey(key, 60)).resolves.toEqual({ state: "completed" });
      await expectPositiveTtlSeconds(key, 60);
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("allows only one concurrent reservation", async () => {
    const key = `idempotency:{${rand()}}`;
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => reserveIdempotencyKey(key, 60)),
      );

      expect(results.filter((result) => result.state === "reserved")).toHaveLength(1);
      expect(results.filter((result) => result.state === "processing")).toHaveLength(9);
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("does not let an old token complete or release a newer reservation", async () => {
    const key = `idempotency:{${rand()}}`;
    try {
      const first = await reserveIdempotencyKey(key, 60);
      expect(first.state).toBe("reserved");
      if (first.state !== "reserved") throw new Error("first reservation failed");

      await cacheValkeyClient.unlink([key]);

      const second = await reserveIdempotencyKey(key, 60);
      expect(second.state).toBe("reserved");
      if (second.state !== "reserved") throw new Error("second reservation failed");

      await expect(completeIdempotencyKey(key, first.token, 60)).resolves.toBe("changed");
      await expect(releaseIdempotencyKey(key, first.token)).resolves.toBe(false);
      await expect(reserveIdempotencyKey(key, 60)).resolves.toEqual({ state: "processing" });

      await expect(completeIdempotencyKey(key, second.token, 60)).resolves.toBe("completed");
      await expect(reserveIdempotencyKey(key, 60)).resolves.toEqual({ state: "completed" });
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("returns missing when completing an absent reservation", async () => {
    await expect(completeIdempotencyKey(`idempotency:{${rand()}}`, "token", 60)).resolves.toBe(
      "missing",
    );
  });

  it("reservation TTL expiry allows later reservation", async () => {
    const key = `idempotency:{${rand()}}`;
    try {
      await reserveIdempotencyKey(key, 1);
      await waitFor(async () => (await cacheValkeyClient.get(key)) === null, 2_500);

      const reservation = await reserveIdempotencyKey(key, 60);
      expect(reservation.state).toBe("reserved");
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("supports custom values and deterministic reserve tokens", async () => {
    const key = `idempotency:{${rand()}}`;
    const options = {
      processingPrefix: "pending",
      completedValue: "done",
      token: "token-1",
    };
    try {
      await expect(reserveIdempotencyKey(key, 60, options)).resolves.toEqual({
        state: "reserved",
        token: "token-1",
      });
      await expect(cacheValkeyClient.get(key)).resolves.toBe("pending:token-1");
      await expect(
        completeIdempotencyKey(key, "token-1", 60, {
          processingPrefix: "pending",
          completedValue: "done",
        }),
      ).resolves.toBe("completed");
      await expect(cacheValkeyClient.get(key)).resolves.toBe("done");
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("requests string decoding for status-returning script calls", async () => {
    const invokeScript = vi
      .fn<GlideClient["invokeScript"]>()
      .mockResolvedValueOnce("reserved")
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce(1);
    const client = { invokeScript } as unknown as GlideClient;

    await expect(reserveIdempotencyKey("key", 60, { client, token: "token" })).resolves.toEqual({
      state: "reserved",
      token: "token",
    });
    await expect(completeIdempotencyKey("key", "token", 60, { client })).resolves.toBe("completed");
    await expect(releaseIdempotencyKey("key", "token", { client })).resolves.toBe(true);

    for (const call of invokeScript.mock.calls) {
      expect(call[1]).toMatchObject({ decoder: Decoder.String });
    }
  });

  it("validates inputs", async () => {
    await expect(getAndDelete("")).rejects.toThrow("key must not be empty");
    await expect(reserveIdempotencyKey("key", 0)).rejects.toThrow(
      "ttlSeconds must be greater than 0",
    );
    await expect(reserveIdempotencyKey("key", 60, { token: "" })).rejects.toThrow(
      "token must not be empty",
    );
    await expect(completeIdempotencyKey("key", "", 60)).rejects.toThrow("token must not be empty");
    await expect(
      reserveIdempotencyKey("key", 60, {
        processingPrefix: "same",
        completedValue: "same",
      }),
    ).rejects.toThrow("processingPrefix must not equal completedValue");
    await expect(
      reserveIdempotencyKey("key", 60, { processingPrefix: "reserved" }),
    ).rejects.toThrow("processingPrefix must not equal a script result sentinel");
    await expect(
      completeIdempotencyKey("key", "token", 60, { completedValue: "missing" }),
    ).rejects.toThrow("completedValue must not equal a script result sentinel");
    await expect(
      releaseIdempotencyKey("key", "token", { completedValue: "processing:token" }),
    ).rejects.toThrow("completedValue must not be in the processing namespace");
  });

  it("throws on unexpected script responses", async () => {
    const client = {
      invokeScript: vi.fn().mockResolvedValue("weird"),
    } as unknown as GlideClient;

    await expect(reserveIdempotencyKey("key", 60, { client })).rejects.toThrow(
      "Unexpected idempotency reserve state: weird",
    );
    await expect(completeIdempotencyKey("key", "token", 60, { client })).rejects.toThrow(
      "Unexpected idempotency completion state: weird",
    );
  });
});

async function expectPositiveTtlSeconds(key: string, maxSeconds: number): Promise<void> {
  const ttl = Number(await cacheValkeyClient.ttl(key));
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(maxSeconds);
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition timed out");
}
