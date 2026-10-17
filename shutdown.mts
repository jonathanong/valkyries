import { urlsToClients, closeDynamicConfigValkeySubscriptionClient } from "./clients.mts";
import { dynamicConfigs } from "./dynamic-config.mts";
import { handleValkeyError } from "./errors.mts";

let shutdown = false;

/**
 * Executes a close method safely, converting synchronous returns and throws into promises.
 * This avoids the overhead of wrapping with Promise.resolve().then() for each item
 * which creates unnecessary wrapper Promises and microtasks during shutdown.
 */
const safeClose = (obj: { close: () => unknown }) => {
  try {
    return obj.close();
  } catch (error) {
    return Promise.reject(error);
  }
};

export interface CloseValkeyClientsOptions {
  /**
   * Reject with an `AggregateError` after every close has settled if any close failed.
   * Failures are still reported to `handleValkeyError`. Defaults to `false`.
   */
  throwOnError?: boolean;
}

/**
 * Closes every live `DynamicConfig`, then every package-managed client and the
 * dynamic-config subscription client. Closing `dynamicConfigs` beforehand is unnecessary.
 *
 * Shutdown runs once per module instance. Later calls are no-ops that resolve immediately,
 * even if they pass `throwOnError` and an earlier call did not (or the first run failed).
 */
export const closeValkeyClients = async (options?: CloseValkeyClientsOptions): Promise<void> => {
  if (shutdown) return;
  shutdown = true;

  const errors: Error[] = [];
  const report = (results: PromiseSettledResult<unknown>[]) => {
    for (const result of results) {
      if (result.status === "rejected") {
        const error = toError(result.reason);
        errors.push(error);
        handleValkeyError(error);
      }
    }
  };

  report(await Promise.allSettled([...dynamicConfigs].map(safeClose)));
  report(
    await Promise.allSettled([
      ...Array.from(urlsToClients.values(), safeClose),
      closeDynamicConfigValkeySubscriptionClient(),
    ]),
  );

  if (options?.throwOnError && errors.length > 0) {
    throw new AggregateError(errors, "Valkey shutdown failed");
  }
};

/**
 * Same as `closeValkeyClients()` but takes no arguments, so it is safe to pass directly as a
 * signal or lifecycle callback that supplies its own arguments. Never rejects on close failures.
 */
export const onGracefulShutdown = (): Promise<void> => closeValkeyClients();

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
