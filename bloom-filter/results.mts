export function normalizeBloomCheckResult(value: unknown): boolean | null {
  if (value === -1 || value === -1n) return null;
  if (value === null || value === undefined) return null;
  if (value === true || value === 1 || value === 1n) return true;
  if (value === false || value === 0 || value === 0n) return false;
  return null;
}

export function isBloomMissingKeyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (!message.includes("bf.madd")) return false;
  return (
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("missing") ||
    message.includes("no such key")
  );
}
