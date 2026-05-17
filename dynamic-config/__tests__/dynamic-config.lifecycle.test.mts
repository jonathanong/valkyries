import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import { it, expect, afterEach, afterAll, describe } from "vitest";

describe("dynamic-config.lifecycle", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // Subscribe/Unsubscribe Tests
  // ============================================

  it("DynamicConfig.subscribe is idempotent", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    // Subscribe is called during initialization, calling again should be safe
    await config.subscribe();
    await config.subscribe();

    // Should not throw
    expect(config.getFields().name).toBe("default");
  });

  it("DynamicConfig.unsubscribe is idempotent", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    // Unsubscribe multiple times should be safe
    config.unsubscribe();
    config.unsubscribe();

    // Should not throw
    expect(config.getFields().name).toBe("default");
  });

  it("DynamicConfig.unsubscribe removes the message handler", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 60,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    // Verify subscribed
    expect(config.getFields().name).toBe("default");

    // Unsubscribe
    config.unsubscribe();

    // Should still have access to fields
    expect(config.getFields().name).toBe("default");

    // Local updates still work
    await config.setField("name", "local-update");
    expect(config.getFields().name).toBe("local-update");
  });

  // ============================================
  // Close Tests
  // ============================================

  it("DynamicConfig.close stops refresh timer and unsubscribes", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 1,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    // Close the config
    await config.close();

    // Should still have access to fields after close
    expect(config.getFields().name).toBe("default");

    // Close should be safe to call again
    await config.close();
  });

  it("DynamicConfig.close is safe to call multiple times", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    // Close multiple times should be safe
    await config.close();
    await config.close();

    // Should not throw
    expect(config.getFields().name).toBe("default");
  });

  it("DynamicConfig subscribes during initialization in tests", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();
    expect(() => config.unsubscribe()).not.toThrow();
    await expect(config.subscribe()).resolves.toBeUndefined();
  });
});
