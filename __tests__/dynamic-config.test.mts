import { describe, expect, it } from "vitest";
import { DynamicConfig } from "../dynamic-config.mts";
import type { DynamicConfigField, DynamicConfigFieldType } from "../types.mts";

describe("dynamic config", () => {
  it("returns configured fields and skips missing map entries in getFields()", () => {
    const config = Object.create(DynamicConfig.prototype) as DynamicConfig;
    config["fields"] = new Map<string, DynamicConfigField>([
      ["enabled", true],
      ["prefix", "default"],
    ]);
    config["fieldsConfig"] = [
      { name: "enabled", type: "boolean" as DynamicConfigFieldType, defaultValue: false },
      { name: "missing", type: "string" as DynamicConfigFieldType, defaultValue: "x" },
      { name: "prefix", type: "string" as DynamicConfigFieldType, defaultValue: "" },
    ];

    expect(config.getFields()).toEqual({
      enabled: true,
      prefix: "default",
    });
  });
});
