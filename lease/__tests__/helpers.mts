import type { GlideClient } from "@valkey/valkey-glide";
import { vi } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";

export const realClient = cacheValkeyClient;

let unique = 0;
export const uniqueKey = (label: string) => `lease-test:${label}:{${process.pid}-${(unique += 1)}}`;

export const fakeTimers = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });

export async function pttl(key: string): Promise<number> {
  return (await realClient.customCommand(["PTTL", key])) as number;
}

/**
 * Wraps a real client so tests can hold, fail and count renewal (two-arg) and release
 * (one-arg) script calls. All commands still reach the real server.
 */
export function controlledClient(real: GlideClient = realClient) {
  const state = {
    hold: false,
    renewError: undefined as unknown,
    releaseError: undefined as unknown,
    renewCalls: 0,
    releaseCalls: 0,
    inFlight: 0,
    maxInFlight: 0,
    held: [] as Array<() => void>,
    settledWaiters: [] as Array<() => void>,
  };
  const client = {
    set: (...args: Parameters<GlideClient["set"]>) => real.set(...args),
    invokeScript: async (...args: Parameters<GlideClient["invokeScript"]>) => {
      if (args[1]?.args?.length !== 2) {
        state.releaseCalls += 1;
        if (state.releaseError) throw state.releaseError;
        return await real.invokeScript(...args);
      }
      state.renewCalls += 1;
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (state.hold) await new Promise<void>((resolve) => state.held.push(resolve));
        if (state.renewError) throw state.renewError;
        return await real.invokeScript(...args);
      } finally {
        state.inFlight -= 1;
        for (const resolve of state.settledWaiters.splice(0)) resolve();
      }
    },
  };
  return {
    client: client as unknown as GlideClient,
    state,
    /** Resolves when the next renewal call settles. */
    nextRenewalSettled: () => new Promise<void>((resolve) => state.settledWaiters.push(resolve)),
    /** Lets every held renewal proceed. */
    releaseHeld: () => {
      state.hold = false;
      for (const resolve of state.held.splice(0)) resolve();
    },
  };
}

/** Runs a renewal tick: advances fake time, then waits for the renewal to settle and flush. */
export async function tickRenewal(
  ctl: ReturnType<typeof controlledClient>,
  ms: number,
): Promise<void> {
  const settled = ctl.nextRenewalSettled();
  await vi.advanceTimersByTimeAsync(ms);
  await settled;
  await vi.advanceTimersByTimeAsync(0);
}
