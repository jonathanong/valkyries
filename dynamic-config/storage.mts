import { dynamicConfigValkeyClient } from "../clients.mts";
import { loadScript, registerScript } from "../scripts.mts";
import type { DynamicConfigField, DynamicConfigFieldType } from "../types.mts";
import type { GlideClient } from "@valkey/valkey-glide";
import { parseField, stringifyField } from "./fields.mts";

export const dynamicConfigSetFieldsScript = registerScript(
  loadScript("dynamic-config-set-fields.lua", new URL("../", import.meta.url)),
);

export async function getDynamicConfigFieldsMap(
  key: string,
  client: GlideClient = dynamicConfigValkeyClient,
): Promise<Record<string, { field: unknown; value: unknown }>> {
  const fields = await client.hgetall(key);
  const fieldsMap: Record<string, { field: unknown; value: unknown }> = {};
  if (Array.isArray(fields)) {
    for (const entry of fields) {
      if (isFieldEntry(entry) && entry.field != null) {
        fieldsMap[entry.field.toString()] = entry;
      }
    }
  }
  return fieldsMap;
}

export async function applyFieldsFromMap({
  fields,
  fieldsMap,
  fieldTypes,
  defaultFields,
  skipFieldNames,
}: {
  fields: Map<string, DynamicConfigField>;
  fieldsMap: Record<string, { field: unknown; value: unknown }>;
  fieldTypes: Record<string, DynamicConfigFieldType>;
  defaultFields: Record<string, DynamicConfigField>;
  skipFieldNames?: ReadonlySet<string>;
}): Promise<void> {
  const parsedValues: [string, DynamicConfigField][] = [];
  let parsedCount = 0;

  for (const [name, type] of Object.entries(fieldTypes)) {
    const valkeyEntry = fieldsMap[name];
    const value =
      valkeyEntry?.value != null
        ? parseField(type, stringifyValkeyField(valkeyEntry.value))
        : defaultFields[name];
    parsedValues.push([name, value]);
    parsedCount += 1;

    // ⚡ Bolt: Yield to the event loop every 1000 fields to prevent blocking when applying huge configs.
    if (parsedCount % 1000 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  for (const [name, value] of parsedValues) {
    if (skipFieldNames?.has(name)) continue;
    fields.set(name, value);
  }
}

export async function writeDynamicConfigFields({
  key,
  args,
  client = dynamicConfigValkeyClient,
}: {
  key: string;
  args: string[];
  client?: GlideClient;
}) {
  if (args.length === 0) return;
  await client.invokeScript(dynamicConfigSetFieldsScript, { keys: [key], args });
}

export function buildMissingDefaultWrites({
  fieldsMap,
  fieldTypes,
  defaultFields,
}: {
  fieldsMap: Record<string, { field: unknown; value: unknown }>;
  fieldTypes: Record<string, DynamicConfigFieldType>;
  defaultFields: Record<string, DynamicConfigField>;
}) {
  const toApply: [string, DynamicConfigField][] = [];
  const writeArgs: string[] = [];
  for (const [name, type] of Object.entries(fieldTypes)) {
    const valkeyEntry = fieldsMap[name];
    const value =
      valkeyEntry?.value != null
        ? parseField(type, stringifyValkeyField(valkeyEntry.value))
        : defaultFields[name];
    if (valkeyEntry?.value == null) writeArgs.push(name, stringifyField(type, value));
    toApply.push([name, value]);
  }
  return { toApply, writeArgs };
}

function stringifyValkeyField(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

function isFieldEntry(entry: unknown): entry is { field: unknown; value: unknown } {
  return !!entry && typeof entry === "object" && "field" in entry && "value" in entry;
}
