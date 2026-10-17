import type { DynamicConfig } from "../dynamic-config.mts";

export type BoundedPositiveIntegerLimits = { defaultValue: number; maxValue: number };

export function getBoundedPositiveIntegerField(
  config: Pick<DynamicConfig, "fields">,
  field: string,
  limits: BoundedPositiveIntegerLimits,
): number {
  const value = config.fields.get(field);
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= limits.maxValue
  ) {
    return value;
  }
  return limits.defaultValue;
}
