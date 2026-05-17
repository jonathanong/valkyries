import { closeDynamicConfigValkeySubscriptionClient } from "../../clients.mts";
import { dynamicConfigs } from "../../dynamic-config.mts";
import { randomUUID } from "node:crypto";

const TEST_DYNAMIC_CONFIG_PREFIX = "dynamic-config:test-";
const TEST_DYNAMIC_CONFIG_KEY_PREFIX = "test-";
type ClosableDynamicConfig = { close(): Promise<void> };

export function createDynamicConfigTestKey(prefix = "config"): string {
  const workerId = process.env.VITEST_WORKER_ID ?? "worker";

  return `${TEST_DYNAMIC_CONFIG_KEY_PREFIX}${workerId}-${prefix}-${randomUUID()}`;
}

export async function closeTestDynamicConfigs(): Promise<void> {
  const testConfigs = [...dynamicConfigs].filter((config) =>
    config.key.startsWith(TEST_DYNAMIC_CONFIG_PREFIX),
  );
  await Promise.all(testConfigs.map((config) => config.close()));
}

export async function closeTestDynamicConfigContext(): Promise<void> {
  await closeTestDynamicConfigs();
  await closeDynamicConfigValkeySubscriptionClient();
}

export async function closeScopedDynamicConfigContext(
  configs: ClosableDynamicConfig[],
): Promise<void> {
  await Promise.all(configs.map((config) => config.close()));
  await closeDynamicConfigValkeySubscriptionClient();
}
