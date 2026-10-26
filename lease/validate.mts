import type { GlideClient } from "@valkey/valkey-glide";
import type { RenewableLeaseOptions } from "../lease.mts";

// Node timers fire immediately for delays above 2^31 - 1 ms, so reject them.
const MAX_TIMER_MS = 2 ** 31 - 1;

export type ResolvedLeaseOptions = {
  ttlMs: number;
  renewalIntervalMs: number;
  client: GlideClient;
};

function validateMs(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > MAX_TIMER_MS) {
    throw new Error(`${name} must be an integer between ${min} and ${MAX_TIMER_MS}`);
  }
}

export function resolveLeaseOptions(
  key: string,
  options: RenewableLeaseOptions,
): ResolvedLeaseOptions {
  if (!key) throw new Error("key must not be empty");
  if (!options?.client) throw new Error("client is required");
  const { ttlMs, client } = options;
  validateMs("ttlMs", ttlMs, 2);
  const renewalIntervalMs = options.renewalIntervalMs ?? Math.max(1, Math.floor(ttlMs / 3));
  validateMs("renewalIntervalMs", renewalIntervalMs, 1);
  if (renewalIntervalMs >= ttlMs) throw new Error("renewalIntervalMs must be less than ttlMs");
  return { ttlMs, renewalIntervalMs, client };
}
