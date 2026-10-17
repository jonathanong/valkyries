import type { DynamicConfigField } from "../types.mts";
import { DynamicConfigValidationError } from "./validation.mts";

type Fields = Record<string, DynamicConfigField>;

/** Requires every number field to be finite and greater than zero. Ignores other types. */
export function validatePositiveNumberFields(next: Fields): void {
  for (const name of Object.keys(next)) {
    const value = next[name];
    if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) {
      throw new DynamicConfigValidationError(`Field ${name} must be a positive finite number`);
    }
  }
}

/** Requires every number field to be an integer greater than zero. Ignores other types. */
export function validatePositiveIntegerFields(next: Fields): void {
  for (const name of Object.keys(next)) {
    const value = next[name];
    if (typeof value === "number" && (!Number.isInteger(value) || value <= 0)) {
      throw new DynamicConfigValidationError(`Field ${name} must be a positive integer`);
    }
  }
}

/** Requires `next[field]` to be a number within `[min, max]`. */
export function validateNumberRange(next: Fields, field: string, min: number, max: number): void {
  const value = next[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new DynamicConfigValidationError(
      `Field ${field} must be a number between ${min} and ${max}`,
    );
  }
}

/** Requires `next[field]` to be one of the allowed strings. */
export function validateOneOf(next: Fields, field: string, allowed: readonly string[]): void {
  const value = next[field];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new DynamicConfigValidationError(`Field ${field} must be one of: ${allowed.join(", ")}`);
  }
}

/** Requires the named number fields to be strictly ascending in the given order. */
export function validateStrictlyAscending(next: Fields, fields: readonly string[]): void {
  for (let i = 1; i < fields.length; i += 1) {
    const previous = next[fields[i - 1]];
    const value = next[fields[i]];
    if (typeof previous !== "number" || typeof value !== "number" || !(previous < value)) {
      throw new DynamicConfigValidationError(`Fields must be ordered: ${fields.join(" < ")}`);
    }
  }
}
