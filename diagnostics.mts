import { InfoOptions, type GlideClient } from "@valkey/valkey-glide";
import { glideStringToString, scanKeyPages, throwIfAborted } from "./scan.mts";

const DEFAULT_SCAN_COUNT = 500;
const UNCLASSIFIED = "unclassified";

export type ValkeyMemorySummary = {
  usedMemoryBytes: number;
  usedMemoryRssBytes: number;
  usedMemoryPeakBytes: number;
  maxmemoryBytes: number;
  maxmemoryPolicy: string;
  usedMemoryDatasetBytes: number | null;
  lazyfreePendingObjects: number | null;
  memFragmentationRatio: number | null;
};

export type DiagnosticsOptions = { signal?: AbortSignal };

export type CountKeysByPrefixOptions = DiagnosticsOptions & {
  /** SCAN COUNT hint per page. Defaults to 500. */
  count?: number;
};

function parseFields(info: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const raw of info.split("\n")) {
    const line = raw.trim();
    const separator = line.indexOf(":");
    if (line.startsWith("#") || separator < 0) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return fields;
}

function parseInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`INFO field ${name} is not a non-negative safe integer: ${value}`);
  }
  return parsed;
}

function parseRatio(name: string, value: string): number {
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`INFO field ${name} is not a non-negative number: ${value}`);
  }
  return Number(value);
}

/**
 * Parses `INFO memory` output (CRLF or LF, `#` section headers) into typed numbers.
 * Throws when a required field is missing or any present numeric field is malformed.
 */
export function parseValkeyMemoryInfo(info: string): ValkeyMemorySummary {
  const fields = parseFields(info);
  const required = (name: string): string => {
    const value = fields.get(name);
    if (!value) throw new Error(`INFO field ${name} is missing`);
    return value;
  };
  const optional = (name: string, parse: (n: string, v: string) => number): number | null => {
    const value = fields.get(name);
    return value === undefined ? null : parse(name, value);
  };

  return {
    usedMemoryBytes: parseInteger("used_memory", required("used_memory")),
    usedMemoryRssBytes: parseInteger("used_memory_rss", required("used_memory_rss")),
    usedMemoryPeakBytes: parseInteger("used_memory_peak", required("used_memory_peak")),
    maxmemoryBytes: parseInteger("maxmemory", required("maxmemory")),
    maxmemoryPolicy: required("maxmemory_policy"),
    usedMemoryDatasetBytes: optional("used_memory_dataset", parseInteger),
    lazyfreePendingObjects: optional("lazyfree_pending_objects", parseInteger),
    memFragmentationRatio: optional("mem_fragmentation_ratio", parseRatio),
  };
}

/** Runs `INFO memory` and parses it. Checks `signal` before and after the command. */
export async function getValkeyMemoryInfo(
  client: Pick<GlideClient, "info">,
  { signal }: DiagnosticsOptions = {},
): Promise<ValkeyMemorySummary> {
  throwIfAborted(signal);
  const info = await client.info([InfoOptions.Memory]);
  throwIfAborted(signal);
  return parseValkeyMemoryInfo(glideStringToString(info));
}

/**
 * Rejects empty prefixes, a group named `unclassified`, and prefixes that overlap across
 * groups (identical, or one a prefix of another), so every key belongs to at most one group.
 */
export function validateKeyPrefixRegistry(prefixes: Record<string, readonly string[]>): void {
  const seen: { group: string; prefix: string }[] = [];
  for (const [group, groupPrefixes] of Object.entries(prefixes)) {
    if (group === UNCLASSIFIED) throw new Error(`Prefix group name is reserved: ${group}`);
    for (const prefix of groupPrefixes) {
      if (prefix === "") throw new Error(`Prefix group ${group} contains an empty prefix`);
      const other = seen.find(
        (entry) =>
          entry.group !== group &&
          (entry.prefix.startsWith(prefix) || prefix.startsWith(entry.prefix)),
      );
      if (other) {
        throw new Error(
          `Prefix ${JSON.stringify(prefix)} in ${group} overlaps ${JSON.stringify(other.prefix)} in ${other.group}`,
        );
      }
      seen.push({ group, prefix });
    }
  }
}

/**
 * Counts keys per prefix group with bounded SCAN pages. Keys matching no prefix are counted as
 * `unclassified`. SCAN is non-snapshot, so counts may include duplicates or miss keys written
 * during the walk. `signal` is checked before and after each page.
 */
export async function countKeysByPrefix<G extends string>(
  client: Pick<GlideClient, "scan">,
  prefixes: Record<G, readonly string[]>,
  { signal, count = DEFAULT_SCAN_COUNT }: CountKeysByPrefixOptions = {},
): Promise<Record<G | "unclassified", number>> {
  validateKeyPrefixRegistry(prefixes);
  const groups = Object.keys(prefixes) as G[];
  const counts: Record<string, number> = { [UNCLASSIFIED]: 0 };
  for (const group of groups) counts[group] = 0;

  for await (const keys of scanKeyPages(client, "*", { count, signal })) {
    for (const key of keys) {
      const name = glideStringToString(key);
      const group = groups.find((g) => prefixes[g].some((prefix) => name.startsWith(prefix)));
      counts[group ?? UNCLASSIFIED] += 1;
    }
  }
  return counts as Record<G | "unclassified", number>;
}
