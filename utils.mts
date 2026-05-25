/**
 * Utility functions for Valkey operations
 */

/**
 * Normalizes TTL result from PTTL command
 * PTTL returns milliseconds: -2 if key doesn't exist, -1 if no expiry, or milliseconds remaining
 * Converts to seconds for internal use, preserving sentinel values
 * valkey-glide returns number or bigint for TTL results
 */
export function normalizeTtlResult(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value === -2 || value === -1) return value; // Preserve sentinel values
    if (value < -2) return null;
    return Math.floor(value / 1000); // Convert milliseconds to seconds
  }
  if (typeof value === "bigint") {
    if (value === -1n || value === -2n) return Number(value);
    if (value < 0n) return null;
    const num = Number(value);
    return Math.floor(num / 1000);
  }
  return null;
}

/**
 * Normalizes count result from Valkey operations (e.g., ZCOUNT)
 * valkey-glide returns number or bigint for count results
 */
export function normalizeCountResult(result: unknown): number {
  if (typeof result === "number") {
    if (!Number.isFinite(result)) return 0;
    return result;
  }
  if (typeof result === "bigint") return Number(result);
  return 0;
}

/**
 * Validates that a prefix is provided and ttlSeconds is greater than 0.
 * Throws an error with the component name if validation fails.
 */
export function validatePrefixAndTtl(
  prefix: string,
  ttlSeconds: number,
  componentName: string,
): void {
  if (!prefix?.trim()) throw new Error(`${componentName} requires a prefix`);
  if (!(ttlSeconds > 0 && Number.isFinite(ttlSeconds)))
    throw new Error(`${componentName}: ttlSeconds must be greater than 0`);
}
