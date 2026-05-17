import type { DynamicConfigField, DynamicConfigFieldType } from "../types.mts";

export function validateFieldTypes(
  fieldTypes: Record<string, DynamicConfigFieldType>,
  defaultFields: Record<string, DynamicConfigField>,
) {
  for (const [name, type] of Object.entries(fieldTypes)) {
    if (!(name in defaultFields)) throw new Error(`Default field ${name} is not defined`);
    const defaultValue = defaultFields[name];
    if (type === "string" && typeof defaultValue !== "string") {
      throw new Error(`Default field ${name} is not of type string`);
    }
    if (type === "number" && typeof defaultValue !== "number") {
      throw new Error(`Default field ${name} is not of type number`);
    }
    if (type === "boolean" && typeof defaultValue !== "boolean") {
      throw new Error(`Default field ${name} is not of type boolean`);
    }
  }
}

export function processFieldValue(
  type: DynamicConfigFieldType,
  value: DynamicConfigField,
): DynamicConfigField {
  if (type === "string") return value.toString();
  if (type === "number") return Number(value);
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "1";
    if (typeof value === "number") return value === 1;
    return Boolean(value);
  }
  throw new Error("Unknown field type");
}

export function stringifyField(type: DynamicConfigFieldType, value: DynamicConfigField): string {
  const normalizedValue = processFieldValue(type, value);
  if (type === "string" || type === "number") return normalizedValue.toString();
  if (type === "boolean") return normalizedValue ? "1" : "0";
  throw new Error("Unknown field type");
}

export function parseField(type: DynamicConfigFieldType, value: string): DynamicConfigField {
  if (type === "string") return value;
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "1";
  throw new Error("Unknown field type");
}
