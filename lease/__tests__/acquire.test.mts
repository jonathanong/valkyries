import type { GlideClient } from "@valkey/valkey-glide";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../index.mts";
import * as leaseModule from "../../lease.mts";
import { acquireRenewableLease } from "../../lease.mts";
import {
  controlledClient,
  fakeTimers,
  pttl,
  realClient,
  tickRenewal,
  uniqueKey,
} from "./helpers.mts";

describe("acquireRenewableLease", () => {
  beforeEach(() => {
    fakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is exported from the module and the package root", () => {
    expect(leaseModule.acquireRenewableLease).toBeTypeOf("function");
    expect(api.acquireRenewableLease).toBe(leaseModule.acquireRenewableLease);
  });

  it("runs real-Valkey fixtures against a noeviction primary", async () => {
    const reply = await realClient.customCommand(["CONFIG", "GET", "maxmemory-policy"]);
    expect(JSON.stringify(reply)).toContain("noeviction");
  });

  it("rejects a missing client and invalid arguments before issuing commands", async () => {
    const set = vi.fn();
    const client = { set } as unknown as GlideClient;
    const bad: Array<[string, Record<string, unknown>]> = [
      ["k", { ttlMs: 1000 }],
      ["k", { ttlMs: 1, client }],
      ["k", { ttlMs: 1.5, client }],
      ["k", { ttlMs: Number.NaN, client }],
      ["k", { ttlMs: 2 ** 31, client }],
      ["k", { ttlMs: 1000, renewalIntervalMs: 0, client }],
      ["k", { ttlMs: 1000, renewalIntervalMs: 1000, client }],
      ["k", { ttlMs: 1000, renewalIntervalMs: 0.5, client }],
      ["", { ttlMs: 1000, client }],
    ];
    for (const [key, options] of bad) {
      await expect(
        acquireRenewableLease(key, options as unknown as leaseModule.RenewableLeaseOptions),
      ).rejects.toThrow();
    }
    await expect(
      acquireRenewableLease("k", undefined as unknown as leaseModule.RenewableLeaseOptions),
    ).rejects.toThrow("client is required");
    expect(set).not.toHaveBeenCalled();
  });

  it("returns null for a collision and throws transport errors without starting timers", async () => {
    const key = uniqueKey("collision");
    try {
      const first = await acquireRenewableLease(key, { ttlMs: 60_000, client: realClient });
      expect(first).not.toBeNull();
      await expect(
        acquireRenewableLease(key, { ttlMs: 60_000, client: realClient }),
      ).resolves.toBeNull();
      await first!.release();

      const failure = new Error("connection reset");
      const client = { set: vi.fn().mockRejectedValue(failure) } as unknown as GlideClient;
      await expect(acquireRenewableLease(key, { ttlMs: 60_000, client })).rejects.toBe(failure);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("yields exactly one owner with a unique token and a finite millisecond TTL", async () => {
    const key = uniqueKey("contend");
    try {
      const results = await Promise.all([
        acquireRenewableLease(key, { ttlMs: 45_000, client: realClient }),
        acquireRenewableLease(key, { ttlMs: 45_000, client: realClient }),
      ]);
      const owners = results.filter((lease) => lease !== null);
      expect(owners).toHaveLength(1);
      const token = await realClient.get(key);
      expect(String(token)).toMatch(/^[0-9a-f-]{36}$/);
      const ttl = await pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(45_000);
      await owners[0]!.release();

      const again = await acquireRenewableLease(key, { ttlMs: 45_000, client: realClient });
      expect(String(await realClient.get(key))).not.toBe(String(token));
      await again!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("defaults the renewal interval to a third of the TTL", async () => {
    const key = uniqueKey("default-interval");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, { ttlMs: 9000, client: ctl.client });
      await vi.advanceTimersByTimeAsync(2999);
      expect(ctl.state.renewCalls).toBe(0);
      await tickRenewal(ctl, 1);
      expect(ctl.state.renewCalls).toBe(1);
      await lease!.release();

      const tiny = await acquireRenewableLease(key, { ttlMs: 2, client: ctl.client });
      expect(tiny).not.toBeNull();
      await tiny!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("does not return a lease acknowledged after its window elapsed, and cleans up its token", async () => {
    const key = uniqueKey("late-ack");
    try {
      const client = {
        set: async (...args: Parameters<GlideClient["set"]>) => {
          const reply = await realClient.set(...args);
          vi.advanceTimersByTime(5000);
          return reply;
        },
        invokeScript: (...args: Parameters<GlideClient["invokeScript"]>) =>
          realClient.invokeScript(...args),
      } as unknown as GlideClient;
      await expect(acquireRenewableLease(key, { ttlMs: 5000, client })).rejects.toThrow(
        "after the TTL elapsed",
      );
      await expect(realClient.get(key)).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("schedules the first renewal from dispatch when acquisition is slow", async () => {
    const key = uniqueKey("slow-ack");
    const ctl = controlledClient();
    const slow = {
      set: async (...args: Parameters<GlideClient["set"]>) => {
        const reply = await realClient.set(...args);
        vi.advanceTimersByTime(800);
        return reply;
      },
      invokeScript: ctl.client.invokeScript,
    } as unknown as GlideClient;
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 900,
        renewalIntervalMs: 300,
        client: slow,
      });
      expect(lease!.isHeld).toBe(true);
      await tickRenewal(ctl, 0);
      expect(ctl.state.renewCalls).toBe(1);
      expect(lease!.isHeld).toBe(true);
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("surfaces the late-acknowledgement error even when best-effort cleanup fails", async () => {
    const client = {
      set: async () => {
        vi.advanceTimersByTime(5000);
        return "OK";
      },
      invokeScript: vi.fn().mockRejectedValue(new Error("cleanup failed")),
    } as unknown as GlideClient;
    await expect(acquireRenewableLease("k", { ttlMs: 5000, client })).rejects.toThrow(
      "after the TTL elapsed",
    );
  });
});
