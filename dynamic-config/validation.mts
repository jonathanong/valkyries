import type { DynamicConfigField } from "../types.mts";
import type {
  DynamicConfigChangedFields,
  DynamicConfigFieldRules,
  DynamicConfigNamespaceDefinition,
  DynamicConfigUpdate,
} from "./types.mts";

export class DynamicConfigValidationError extends Error {
  override name = "DynamicConfigValidationError";
}

/**
 * Validates untrusted changes against a namespace definition without writing anything.
 * Values must already have their declared runtime type; unlike `DynamicConfig.setFields`, nothing
 * is coerced. Runs the definition's `validate` hook on `current` merged with the changes.
 */
export function validateDynamicConfigUpdate(
  definition: DynamicConfigNamespaceDefinition,
  current: Record<string, DynamicConfigField>,
  changes: unknown,
): DynamicConfigUpdate {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) {
    throw new DynamicConfigValidationError("Changes must be an object");
  }
  const names = Object.keys(changes);
  if (names.length === 0) {
    throw new DynamicConfigValidationError("Changes must not be empty");
  }

  // Null prototype so a declared `__proto__` field stays an own property.
  const validated: Record<string, DynamicConfigField> = Object.create(null);
  let changed = false;
  for (const name of names) {
    const value = validateFieldValue(definition, name, (changes as Record<string, unknown>)[name]);
    validated[name] = value;
    if (current[name] !== value) changed = true;
  }

  const next = { ...current, ...validated };
  definition.validate?.(next);
  return { changes: validated, next, changed };
}

function validateFieldValue(
  definition: DynamicConfigNamespaceDefinition,
  name: string,
  value: unknown,
): DynamicConfigField {
  const { fieldTypes } = definition.config;
  if (!Object.hasOwn(fieldTypes, name)) {
    throw new DynamicConfigValidationError(`Unknown field: ${name}`);
  }
  const type = fieldTypes[name];
  if (type !== "number") {
    if (typeof value !== type) {
      throw new DynamicConfigValidationError(`Field ${name} must be a ${type}`);
    }
    return value as boolean | string;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DynamicConfigValidationError(`Field ${name} must be a finite number`);
  }
  validateNumberRules(name, value, definition.fields[name]);
  return value;
}

function validateNumberRules(
  name: string,
  value: number,
  rules: DynamicConfigFieldRules | undefined,
): void {
  if (rules?.integer && !Number.isSafeInteger(value)) {
    throw new DynamicConfigValidationError(`Field ${name} must be a safe integer`);
  }
  if (rules?.minValue !== undefined && value < rules.minValue) {
    throw new DynamicConfigValidationError(
      `Field ${name} must be greater than or equal to ${rules.minValue}`,
    );
  }
  if (rules?.maxValue !== undefined && value > rules.maxValue) {
    throw new DynamicConfigValidationError(
      `Field ${name} must be less than or equal to ${rules.maxValue}`,
    );
  }
}

/** Shallow diff of two field snapshots. Absent keys read as `undefined`. */
export function getChangedFields(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): DynamicConfigChangedFields {
  const before = previous ?? {};
  const after = next ?? {};
  const changed: DynamicConfigChangedFields = Object.create(null);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previousValue = Object.hasOwn(before, key) ? before[key] : undefined;
    const nextValue = Object.hasOwn(after, key) ? after[key] : undefined;
    if (previousValue !== nextValue) changed[key] = { previous: previousValue, next: nextValue };
  }
  return changed;
}
