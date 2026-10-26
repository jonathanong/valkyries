import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import { it, expect, afterEach, afterAll, describe, vi } from "vitest";
import { dynamicConfigValkeyClient } from "../../clients.mts";
import { setValkeyErrorHandler, type ValkeyErrorHandler } from "../../errors.mts";

describe("dynamic-config.init", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // Initialization Tests
  // ============================================

  it("DynamicConfig initializes with default values", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        count: "number",
        enabled: "boolean",
      },
      defaultFields: {
        name: "default",
        count: 0,
        enabled: false,
      },
    });

    await config.waitForInitialization();

    const fields = config.getFields();
    expect(fields.name).toBe("default");
    expect(fields.count).toBe(0);
    expect(fields.enabled).toBe(false);
  });

  it("DynamicConfig loads values from Valkey", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

    // Set initial values in Valkey
    await dynamicConfigValkeyClient.hset(configKey, {
      name: "loaded",
      count: "42",
      enabled: "1",
    });

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        count: "number",
        enabled: "boolean",
      },
      defaultFields: {
        name: "default",
        count: 0,
        enabled: false,
      },
    });

    await config.waitForInitialization();

    const fields = config.getFields();
    expect(fields.name).toBe("loaded");
    expect(fields.count).toBe(42);
    expect(fields.enabled).toBe(true);
  });

  it("DynamicConfig.initialize preserves fields map identity", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });
    const fieldsRef = config.fields;

    await config.waitForInitialization();

    expect(config.fields).toBe(fieldsRef);
    expect(config.getFields().name).toBe("default");
  });

  it("DynamicConfig uses default staleTtl of 60 when not provided", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 0, // Falsy value should use default
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();
    expect(config.staleTtl).toBe(60);
  });

  it("DynamicConfig reports initialization failures to the Valkey error handler", async () => {
    const handler = vi.fn<ValkeyErrorHandler>();
    const unhandled = vi.fn();
    setValkeyErrorHandler(handler);
    process.on("unhandledRejection", unhandled);
    try {
      const config = new DynamicConfig({
        key: createDynamicConfigTestKey(),
        staleTtlSeconds: 10,
        fieldTypes: { name: "string" },
        defaultFields: { name: 123 },
      });

      await expect(config.waitForInitialization()).rejects.toThrow(
        "Default field name is not of type string",
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Default field name is not of type string" }),
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      setValkeyErrorHandler(() => {});
    }
  });

  it("DynamicConfig emits a warning when the error handler throws during initialization", async () => {
    const handlerError = new Error("handler failed");
    const unhandled = vi.fn();
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    setValkeyErrorHandler(() => {
      throw handlerError;
    });
    process.on("unhandledRejection", unhandled);
    try {
      const config = new DynamicConfig({
        key: createDynamicConfigTestKey(),
        staleTtlSeconds: 10,
        fieldTypes: { name: "string" },
        defaultFields: { name: 123 },
      });

      await expect(config.waitForInitialization()).rejects.toThrow(
        "Default field name is not of type string",
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(emitWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "DynamicConfig initialization error handler threw",
          cause: handlerError,
        }),
      );
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      emitWarning.mockRestore();
      setValkeyErrorHandler(() => {});
    }
  });
});
