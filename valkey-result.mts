export function stringifyValkeyResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "bigint" || typeof result === "boolean") {
    return result.toString();
  }
  return JSON.stringify(result) ?? "[unserializable]";
}
