import { urlsToClients, closeDynamicConfigValkeySubscriptionClient } from "./clients.mts";
import { dynamicConfigs } from "./dynamic-config.mts";
import { handleValkeyError } from "./errors.mts";

let shutdown = false;

export const onGracefulShutdown = async (): Promise<void> => {
  if (shutdown) return;
  shutdown = true;

  const configResults = await Promise.allSettled(
    [...dynamicConfigs].map((config) => Promise.resolve().then(() => config.close())),
  );
  for (const result of configResults) {
    if (result.status === "rejected") handleValkeyError(toError(result.reason));
  }

  const results = await Promise.allSettled([
    ...[...urlsToClients.values()].map((client) => Promise.resolve().then(() => client.close())),
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
