import { describe, expect, it, vi } from "vitest";
import type { DynamicConfigNamespaceDefinition } from "../types.mts";
import {
  DynamicConfigValidationError,
  getChangedFields,
  validateDynamicConfigUpdate,
} from "../validation.mts";

const definition: DynamicConfigNamespaceDefinition = {
  namespace: "demo",
  config: { fieldTypes: { enabled: "boolean", limit: "number", mode: "string" } },
  fields: { enabled: {}, limit: { minValue: 1, maxValue: 10, integer: true }, mode: {} },
};
const current = { enabled: false, limit: 5, mode: "a" };

describe("dynamic-config.update-validation", () => {
  it("validateDynamicConfigUpdate returns validated changes, merged fields, and changed", () => {
    expect(validateDynamicConfigUpdate(definition, current, { limit: 3, mode: "a" })).toEqual({
      changes: { limit: 3, mode: "a" },
      next: { enabled: false, limit: 3, mode: "a" },
      changed: true,
    });
    expect(validateDynamicConfigUpdate(definition, current, { enabled: false })).toEqual({
      changes: { enabled: false },
      next: current,
      changed: false,
    });
  });

  it.each([
    [null, "Changes must be an object"],
    ["x", "Changes must be an object"],
    [[], "Changes must be an object"],
    [{}, "Changes must not be empty"],
    [{ nope: 1 }, "Unknown field: nope"],
    [{ toString: 1 }, "Unknown field: toString"],
    [{ enabled: "true" }, "Field enabled must be a boolean"],
    [{ mode: 1 }, "Field mode must be a string"],
    [{ limit: Number.NaN }, "Field limit must be a finite number"],
    [{ limit: "3" }, "Field limit must be a finite number"],
    [{ limit: 2.5 }, "Field limit must be a safe integer"],
    [{ limit: 0 }, "Field limit must be greater than or equal to 1"],
    [{ limit: 11 }, "Field limit must be less than or equal to 10"],
  ])("validateDynamicConfigUpdate rejects %j", (changes, message) => {
    expect(() => validateDynamicConfigUpdate(definition, current, changes)).toThrow(
      new DynamicConfigValidationError(message),
    );
  });

  it("validateDynamicConfigUpdate applies no number rules without rules", () => {
    const bare = { ...definition, fields: { enabled: {}, limit: {}, mode: {} } };
    expect(validateDynamicConfigUpdate(bare, current, { limit: -1.5 }).changes).toEqual({
      limit: -1.5,
    });
    const missing = { ...definition, fields: {} };
    expect(validateDynamicConfigUpdate(missing, current, { limit: 1e9 }).changes).toEqual({
      limit: 1e9,
    });
  });

  it("validateDynamicConfigUpdate runs the validate hook on the merged fields", () => {
    const validate = vi.fn((next: Record<string, unknown>) => {
      if (next.mode === "bad") throw new DynamicConfigValidationError("bad mode");
    });
    const hooked = { ...definition, validate };
    validateDynamicConfigUpdate(hooked, current, { limit: 2 });
    expect(validate).toHaveBeenCalledWith({ enabled: false, limit: 2, mode: "a" });
    expect(() => validateDynamicConfigUpdate(hooked, current, { mode: "bad" })).toThrow("bad mode");
  });

  it("DynamicConfigValidationError is a named Error", () => {
    const error = new DynamicConfigValidationError("x");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DynamicConfigValidationError");
  });

  it("getChangedFields diffs field snapshots", () => {
    expect(getChangedFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual({
      b: { previous: 2, next: 3 },
      c: { previous: undefined, next: 4 },
    });
    expect(getChangedFields({ a: 1 }, null)).toEqual({ a: { previous: 1, next: undefined } });
    expect(getChangedFields(null, undefined)).toEqual({});
  });
});
