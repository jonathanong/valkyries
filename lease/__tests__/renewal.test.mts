import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRenewableLease } from "../../lease.mts";
import type { RenewableLeaseLoss } from "../../lease.mts";
import {
  controlledClient,
  fakeTimers,
  pttl,
  realClient,
  tickRenewal,
  uniqueKey,
} from "./helpers.mts";

const PENDING = Symbol("pending");
const settledOrPending = (promise: Promise<unknown>) =>
  Promise.race([promise, Promise.resolve(PENDING)]);

describe("lease renewal", () => {
  beforeEach(() => {
    fakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews beyond the initial TTL with an owner-conditional extension", async () => {
    const key = uniqueKey("renew");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      // Shrink the server TTL so only a renewal can push it back up.
      await realClient.customCommand(["PEXPIRE", key, "2000"]);
      await tickRenewal(ctl, 1000);
      expect(await pttl(key)).toBeGreaterThan(30_000);
      expect(lease!.isHeld).toBe(true);
      await tickRenewal(ctl, 1000);
      expect(ctl.state.renewCalls).toBe(2);
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("never runs two renewals at once while one is slow", async () => {
    const key = uniqueKey("serialized");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 100_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      ctl.state.hold = true;
      await vi.advanceTimersByTimeAsync(5000);
      expect(ctl.state.renewCalls).toBe(1);
      expect(ctl.state.maxInFlight).toBe(1);

      const settled = ctl.nextRenewalSettled();
      ctl.releaseHeld();
      await settled;
      // The slow renewal overran its interval, so the next one is scheduled immediately.
      await tickRenewal(ctl, 0);
      expect(ctl.state.renewCalls).toBe(2);
      expect(ctl.state.maxInFlight).toBe(1);
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("resolves not-owner once when the key is deleted out from under the owner", async () => {
    const key = uniqueKey("not-owner");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      const onLost = vi.fn();
      let heldAtNotify: boolean | undefined;
      void lease!.lost.then((loss) => {
        heldAtNotify = lease!.isHeld;
        onLost(loss);
      });
      await realClient.unlink([key]); // eviction or expiry
      await tickRenewal(ctl, 1000);
      expect(onLost).toHaveBeenCalledTimes(1);
      expect(onLost).toHaveBeenCalledWith({ reason: "not-owner" });
      expect(heldAtNotify).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(ctl.state.renewCalls).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      await expect(realClient.get(key)).resolves.toBeNull();
      expect(onLost).toHaveBeenCalledTimes(1);
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("resolves renewal-error once with the original error and stops renewing", async () => {
    const key = uniqueKey("renew-error");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      const failure = new Error("renewal failed");
      ctl.state.renewError = failure;
      let heldAtNotify: boolean | undefined;
      const lost = lease!.lost.then((loss) => {
        heldAtNotify = lease!.isHeld;
        return loss;
      });
      await tickRenewal(ctl, 1000);
      const loss = (await lost) as Extract<RenewableLeaseLoss, { reason: "renewal-error" }>;
      expect(loss.reason).toBe("renewal-error");
      expect(loss.error).toBe(failure);
      expect(heldAtNotify).toBe(false);

      ctl.state.renewError = undefined;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ctl.state.renewCalls).toBe(1);
      expect(String(await realClient.get(key))).not.toBe("null");
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("expires locally when a renewal stays pending, and a late response cannot revive it", async () => {
    const key = uniqueKey("pending-renewal");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 3000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      ctl.state.hold = true;
      await vi.advanceTimersByTimeAsync(1000);
      expect(ctl.state.renewCalls).toBe(1);
      expect(lease!.isHeld).toBe(true);

      await vi.advanceTimersByTimeAsync(1999);
      expect(lease!.isHeld).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await expect(settledOrPending(lease!.lost)).resolves.toEqual({ reason: "expired" });
      expect(lease!.isHeld).toBe(false);

      const settled = ctl.nextRenewalSettled();
      ctl.releaseHeld();
      await settled;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lease!.isHeld).toBe(false);
      expect(ctl.state.renewCalls).toBe(1);
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("keeps the caller's pending external operation alive through loss", async () => {
    const key = uniqueKey("caller-work");
    const ctl = controlledClient();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 60_000,
        renewalIntervalMs: 1000,
        client: ctl.client,
      });
      let finish!: (value: string) => void;
      const external = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const recorded: string[] = [];
      const work = (async () => {
        recorded.push(await external);
        return "done";
      })();

      await realClient.unlink([key]);
      await tickRenewal(ctl, 1000);
      await expect(lease!.lost).resolves.toEqual({ reason: "not-owner" });
      expect(lease!.isHeld).toBe(false);
      await expect(settledOrPending(work)).resolves.toBe(PENDING);

      finish("receipt");
      await expect(work).resolves.toBe("done");
      expect(recorded).toEqual(["receipt"]);
    } finally {
      await realClient.unlink([key]);
    }
  });
});

describe("lease monotonic deadline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("settles loss synchronously on read when time passed without the timer running", async () => {
    const key = uniqueKey("deadline-read");
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const lease = await acquireRenewableLease(key, { ttlMs: 30_000, client: realClient });
      expect(lease!.isHeld).toBe(true);
      now += 30_000;
      expect(lease!.isHeld).toBe(false);
      await expect(lease!.lost).resolves.toEqual({ reason: "expired" });
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("does not dispatch an overdue renewal once the deadline has passed", async () => {
    const key = uniqueKey("deadline-overdue");
    const ctl = controlledClient();
    fakeTimers();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 900,
        renewalIntervalMs: 300,
        client: ctl.client,
      });
      const base = performance.now();
      // The event loop was blocked past the deadline before the renewal timer ran.
      vi.spyOn(performance, "now").mockImplementation(() => base + 900);
      await vi.advanceTimersByTimeAsync(300);
      expect(ctl.state.renewCalls).toBe(0);
      await expect(lease!.lost).resolves.toEqual({ reason: "expired" });
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });

  it("re-arms the expiry timer when it fires early", async () => {
    const key = uniqueKey("deadline-early");
    const ctl = controlledClient();
    fakeTimers();
    try {
      const lease = await acquireRenewableLease(key, {
        ttlMs: 10_000,
        renewalIntervalMs: 9999,
        client: ctl.client,
      });
      ctl.state.hold = true;
      const base = performance.now();
      const clock = vi.spyOn(performance, "now");
      // The expiry timer fires while the monotonic clock is still short of the deadline.
      clock.mockImplementation(() => base - 1000);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ctl.state.renewCalls).toBe(1);
      expect(lease!.isHeld).toBe(true);
      clock.mockImplementation(() => base + 10_000);
      await vi.advanceTimersByTimeAsync(11_000);
      await expect(lease!.lost).resolves.toEqual({ reason: "expired" });
      ctl.releaseHeld();
      await lease!.release();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
      await realClient.unlink([key]);
    }
  });
});
