import type { DynamicConfigField, DynamicConfigFieldType } from "../types.mts";

/** The subset of a `DynamicConfig` that namespace definitions and update validation read. */
export type DynamicConfigSchema = {
  fieldTypes: Record<string, DynamicConfigFieldType>;
};

/** Per-field update rules and display metadata. */
export type DynamicConfigFieldRules = {
  description?: string | undefined;
  /** Inclusive lower bound for number fields. */
  minValue?: number | undefined;
  /** Inclusive upper bound for number fields. */
  maxValue?: number | undefined;
  /** Why a number field intentionally has no `maxValue`. */
  maxValueExemption?: string | undefined;
  /** Requires number fields to be safe integers. */
  integer?: boolean | undefined;
};

export type DynamicConfigNamespaceDefinition<
  TConfig extends DynamicConfigSchema = DynamicConfigSchema,
> = {
  namespace: string;
  config: TConfig;
  /** Rules for every field in `config.fieldTypes`, and no others. */
  fields: Record<string, DynamicConfigFieldRules>;
  /** Cross-field validator over the merged fields; throws to reject an update. */
  validate?: ((next: Record<string, DynamicConfigField>) => void) | undefined;
};

export type DynamicConfigRegistry<
  T extends DynamicConfigNamespaceDefinition = DynamicConfigNamespaceDefinition,
> = {
  readonly entries: readonly T[];
  get(namespace: string): T | null;
};

export type DynamicConfigUpdate = {
  /** The requested changes after type and rule checks. */
  changes: Record<string, DynamicConfigField>;
  /** `current` merged with `changes`. */
  next: Record<string, DynamicConfigField>;
  /** Whether any requested value differs from `current`. */
  changed: boolean;
};

export type DynamicConfigChangedFields = Record<string, { previous: unknown; next: unknown }>;
