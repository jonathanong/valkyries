import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRenewableLease } from "../../lease.mts";
import {
  controlledClient,
  fakeTimers,
  pttl,
  realClient,
  tickRenewal,
  uniqueKey,
} from "./helpers.mts";

const PENDING = Symbol("pending");

describe("lease release", () => {
  beforeEach(() => {
    fakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cannot extend, overwrite or delete a successor after the key is lost", async () => {
    const key = uniqueKey("successor");
    const ctl = controlledClient();
    try {
      const old = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      await realClient.customCommand(["PEXPIREAT", key, "1"]); // server-side expiry in the past
      await expect(realClient.get(key)).resolves.toBeNull();
      const successor = await acquireRenewableLease(key, { ttlMs: 5000, client: realClient });
      const successorToken = await realClient.get(key);
      expect(successor).not.toBeNull();

      await tickRenewal(ctl, 1000);
      await expect(old!.lost).resolves.toEqual({ reason: "not-owner" });
      expect(await realClient.get(key)).toBe(successorToken);
      expect(await pttl(key)).toBeLessThanOrEqual(5000);

      await expect(old!.release()).resolves.toBe(false);
      expect(await realClient.get(key)).toBe(successorToken);
      expect(successor!.isHeld).toBe(true);
      await expect(successor!.release()).resolves.toBe(true);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("stops a racing in-flight renewal without resurrection or a loss notification", async () => {
    const key = uniqueKey("release-race");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      ctl.state.hold = true;
      await vi.advanceTimersByTimeAsync(1000);
      expect(ctl.state.renewCalls).toBe(1);

      const released = lease!.release();
      expect(lease!.isHeld).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      ctl.releaseHeld();
      await expect(released).resolves.toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(ctl.state.renewCalls).toBe(1);
      expect(lease!.isHeld).toBe(false);
      await expect(realClient.get(key)).resolves.toBeNull();
      await expect(Promise.race([lease!.lost, Promise.resolve(PENDING)])).resolves.toBe(PENDING);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("does not report loss when a renewal fails after release began", async () => {
    const key = uniqueKey("release-then-error");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      ctl.state.hold = true;
      ctl.state.renewError = new Error("late failure");
      await vi.advanceTimersByTimeAsync(1000);
      const released = lease!.release();
      ctl.releaseHeld();
      await expect(released).resolves.toBe(true);
      await expect(Promise.race([lease!.lost, Promise.resolve(PENDING)])).resolves.toBe(PENDING);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("shares one cleanup across repeated and concurrent releases without touching a successor", async () => {
    const key = uniqueKey("repeat-release");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, { ttlMs: 60_000, client: ctl.client });
      const [a, b] = [lease!.release(), lease!.release()];
      await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
      expect(ctl.state.releaseCalls).toBe(1);

      const successor = await acquireRenewableLease(key, { ttlMs: 60_000, client: realClient });
      const successorToken = await realClient.get(key);
      await expect(lease!.release()).resolves.toBe(true);
      expect(ctl.state.releaseCalls).toBe(1);
      expect(await realClient.get(key)).toBe(successorToken);
      expect(ctl.state.renewCalls).toBe(0);
      await successor!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("surfaces cleanup failures to every caller and keeps renewal stopped", async () => {
    const key = uniqueKey("release-failure");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      const failure = new Error("unlink failed");
      ctl.state.releaseError = failure;
      const first = lease!.release();
      const second = lease!.release();
      await expect(first).rejects.toBe(failure);
      await expect(second).rejects.toBe(failure);
      await expect(lease!.release()).rejects.toBe(failure);
      expect(ctl.state.releaseCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(ctl.state.renewCalls).toBe(0);
      expect(lease!.isHeld).toBe(false);
      // The owner's key survives until its finite TTL because cleanup failed.
      expect(await pttl(key)).toBeGreaterThan(0);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("stops all timers on release and leaves the caller's client open", async () => {
    const key = uniqueKey("timers");
    try {
      const lease = await acquireRenewableLease(key, { ttlMs: 60_000, client: realClient });
      expect(vi.getTimerCount()).toBe(2);
      await lease!.release();
      expect(vi.getTimerCount()).toBe(0);
      await expect(realClient.get(key)).resolves.toBeNull();
    } finally {
      await realClient.unlink([key]);
    }
  });
});

describe("lease timers are unref'd", () => {
  it("does not add a ref'd timer that would keep the process alive", async () => {
    const key = uniqueKey("unref");
    const refTimers = () =>
      process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
    try {
      const before = refTimers();
      const lease = await acquireRenewableLease(key, { ttlMs: 60_000, client: realClient });
      expect(refTimers()).toBe(before);
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });
});
