import { randomUUID } from "node:crypto";
import { TimeUnit, type GlideClient } from "@valkey/valkey-glide";
import { unlinkIfValueMatches } from "./conditional.mts";
import { LeaseController } from "./lease/controller.mts";
import { resolveLeaseOptions } from "./lease/validate.mts";

export interface RenewableLeaseOptions {
  /** Lease TTL in milliseconds (>= 2). */
  ttlMs: number;
  /** Renewal cadence in milliseconds, `1 <= n < ttlMs`. Defaults to `max(1, floor(ttlMs / 3))`. */
  renewalIntervalMs?: number;
  /**
   * Required, with no default. Must target a primary whose server uses
   * `maxmemory-policy noeviction`. Eviction (including `volatile-*` policies, since leases carry
   * a TTL) can delete a held key, letting another owner acquire with no signal until the next
   * renewal. The package cache client is deliberately not used as a default for this reason.
   * The client is never closed by the lease.
   */
  client: GlideClient;
}

export type RenewableLeaseLoss =
  | { reason: "not-owner" }
  | { reason: "renewal-error"; error: unknown }
  | { reason: "expired" };

/**
 * A renewable, token-owned lease. This is not a fencing token: a paused or disconnected former
 * owner can overlap a successor after expiry.
 */
export interface RenewableLease {
  /** Local confirmed ownership window; false after loss or release. */
  readonly isHeld: boolean;
  /** Resolves once on loss; never rejects or cancels caller work. */
  readonly lost: Promise<RenewableLeaseLoss>;
  /** Stop renewal, serialize cleanup, then delete only this owner's value. */
  release(): Promise<boolean>;
}

/**
 * Acquires `key` with `SET NX PX`. Resolves `null` only on a confirmed collision, throws on
 * invalid arguments or transport errors, and does not retry.
 */
export async function acquireRenewableLease(
  key: string,
  options: RenewableLeaseOptions,
): Promise<RenewableLease | null> {
  const resolved = resolveLeaseOptions(key, options);
  const token = randomUUID();
  // Conservative: the validity window starts at dispatch, not at the acknowledgement.
  const dispatchedAt = performance.now();
  const reply = await resolved.client.set(key, token, {
    conditionalSet: "onlyIfDoesNotExist",
    expiry: { type: TimeUnit.Milliseconds, count: resolved.ttlMs },
  });
  if (reply === null) return null;
  if (performance.now() - dispatchedAt >= resolved.ttlMs) {
    // Best-effort, token-conditional cleanup; the finite TTL bounds it otherwise.
    await unlinkIfValueMatches(key, token, { client: resolved.client }).catch(() => false);
    throw new Error("Lease acquisition acknowledgement arrived after the TTL elapsed");
  }
  return new LeaseController(key, token, resolved, dispatchedAt);
}
