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

export const onGracefulShutdown = async (): Promise<void> => {
  if (shutdown) return;
  shutdown = true;

  const configResults = await Promise.allSettled([...dynamicConfigs].map(safeClose));
  for (const result of configResults) {
    if (result.status === "rejected") handleValkeyError(toError(result.reason));
  }

  const results = await Promise.allSettled([
    ...Array.from(urlsToClients.values(), safeClose),
    closeDynamicConfigValkeySubscriptionClient(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") handleValkeyError(toError(result.reason));
  }
};

export const closeValkeyClients = onGracefulShutdown;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
