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
    if (value === -2 || value === -1) return value; // Preserve sentinel values
    return Math.floor(value / 1000); // Convert milliseconds to seconds
  }
  if (typeof value === "bigint") {
    const num = Number(value);
    if (num === -2 || num === -1) return num;
    return Math.floor(num / 1000);
  }
  return null;
}

/**
 * Normalizes count result from Valkey operations (e.g., ZCOUNT)
 * valkey-glide returns number or bigint for count results
 */
export function normalizeCountResult(result: unknown): number {
  if (typeof result === "number") return result;
  if (typeof result === "bigint") return Number(result);
  return 0;
}
