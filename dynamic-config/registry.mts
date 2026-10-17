import type {
  DynamicConfigFieldRules,
  DynamicConfigNamespaceDefinition,
  DynamicConfigRegistry,
} from "./types.mts";

/**
 * Returns the definition unchanged, or throws when its field rules do not cover exactly the
 * config's `fieldTypes`.
 */
export function defineDynamicConfigNamespace<T extends DynamicConfigNamespaceDefinition>(
  definition: T,
): T {
  const { fieldTypes } = definition.config;
  const missing = Object.keys(fieldTypes).filter((name) => !Object.hasOwn(definition.fields, name));
  const extra = Object.keys(definition.fields).filter((name) => !Object.hasOwn(fieldTypes, name));
  if (missing.length === 0 && extra.length === 0) return definition;

  const details: string[] = [];
  if (missing.length > 0) details.push(`missing rules: ${missing.join(", ")}`);
  if (extra.length > 0) details.push(`extra rules: ${extra.join(", ")}`);
  throw new Error(
    `DynamicConfig field rules drift for ${definition.namespace}: ${details.join("; ")}`,
  );
}

/** Sets `maxValueExemption` on every field without a `maxValue`, except the named ones. */
export function withMaxValueExemption<T extends Record<string, DynamicConfigFieldRules>>(
  fields: T,
  reason: string,
  except: readonly string[] = [],
): T {
  const result: Record<string, DynamicConfigFieldRules> = {};
  for (const name of Object.keys(fields)) {
    const rules = fields[name];
    result[name] =
      rules.maxValue === undefined && !except.includes(name)
        ? { ...rules, maxValueExemption: reason }
        : rules;
  }
  return result as T;
}

/** Indexes definitions by namespace. Throws on duplicate namespaces. */
export function createDynamicConfigRegistry<T extends DynamicConfigNamespaceDefinition>(
  entries: readonly T[],
): DynamicConfigRegistry<T> {
  const byNamespace = new Map<string, T>();
  for (const entry of entries) {
    if (byNamespace.has(entry.namespace)) {
      throw new Error(`Duplicate dynamic config namespace: ${entry.namespace}`);
    }
    byNamespace.set(entry.namespace, entry);
  }
  return {
    entries: [...entries],
    get: (namespace) => byNamespace.get(namespace) ?? null,
  };
}
