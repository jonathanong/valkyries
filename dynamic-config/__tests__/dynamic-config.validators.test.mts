import { describe, expect, it } from "vitest";
import { DynamicConfigValidationError } from "../validation.mts";
import {
  validateNumberRange,
  validateOneOf,
  validatePositiveIntegerFields,
  validatePositiveNumberFields,
  validateStrictlyAscending,
} from "../validators.mts";

describe("dynamic-config.validators", () => {
  it("validatePositiveNumberFields requires positive finite numbers and ignores other types", () => {
    expect(() => validatePositiveNumberFields({ a: 1.5, b: "x", c: true })).not.toThrow();
    expect(() => validatePositiveNumberFields({ a: 0 })).toThrow(DynamicConfigValidationError);
    expect(() => validatePositiveNumberFields({ a: Infinity })).toThrow(
      "Field a must be a positive finite number",
    );
  });

  it("validatePositiveIntegerFields requires positive integers and ignores other types", () => {
    expect(() => validatePositiveIntegerFields({ a: 2, b: "x" })).not.toThrow();
    expect(() => validatePositiveIntegerFields({ a: 1.5 })).toThrow(
      "Field a must be a positive integer",
    );
    expect(() => validatePositiveIntegerFields({ a: 0 })).toThrow(DynamicConfigValidationError);
  });

  it("validateNumberRange checks inclusive ranges", () => {
    expect(() => validateNumberRange({ a: 0 }, "a", 0, 1)).not.toThrow();
    expect(() => validateNumberRange({ a: 1 }, "a", 0, 1)).not.toThrow();
    for (const a of [2, -1, "x", Number.NaN]) {
      expect(() => validateNumberRange({ a }, "a", 0, 1)).toThrow(
        new DynamicConfigValidationError("Field a must be a number between 0 and 1"),
      );
    }
  });

  it("validateOneOf checks enumerated strings", () => {
    expect(() => validateOneOf({ m: "on" }, "m", ["on", "off"])).not.toThrow();
    expect(() => validateOneOf({ m: "x" }, "m", ["on", "off"])).toThrow(
      new DynamicConfigValidationError("Field m must be one of: on, off"),
    );
    expect(() => validateOneOf({ m: 1 }, "m", ["on"])).toThrow(DynamicConfigValidationError);
  });

  it("validateStrictlyAscending checks strict numeric ordering", () => {
    expect(() => validateStrictlyAscending({ a: 1, b: 2, c: 3 }, ["a", "b", "c"])).not.toThrow();
    expect(() => validateStrictlyAscending({ a: 1 }, ["a"])).not.toThrow();
    expect(() => validateStrictlyAscending({ a: 1, b: 1 }, ["a", "b"])).toThrow(
      new DynamicConfigValidationError("Fields must be ordered: a < b"),
    );
    expect(() => validateStrictlyAscending({ a: "1", b: 2 }, ["a", "b"])).toThrow("a < b");
    expect(() => validateStrictlyAscending({ a: 1, b: "2" }, ["a", "b"])).toThrow("a < b");
    expect(() => validateStrictlyAscending({ a: 1 }, ["a", "b"])).toThrow("a < b");
  });
});
