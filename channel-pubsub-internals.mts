import type { GlideString } from "@valkey/valkey-glide";

export function decrement(counts: Map<string, number>, key: string): void {
  const count = (counts.get(key) ?? 1) - 1;
  if (count <= 0) counts.delete(key);
  else counts.set(key, count);
}

export function removeHandler<T>(
  handlers: Map<string, Set<(value: T) => void>>,
  key: string,
  handler: (value: T) => void,
): void {
  const active = handlers.get(key);
  if (!active) return;
  active.delete(handler);
  if (active.size === 0) handlers.delete(key);
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function glideStringToString(value: GlideString): string {
  return typeof value === "string" ? value : value.toString();
}

export function assertChannelPart(name: string, value: string): void {
  if (value.length === 0 || /[?*[\]\\]/.test(value)) {
    throw new Error(`${name} must be non-empty and cannot contain Valkey glob characters`);
  }
}

export function deliver<T>(
  handler: (value: T) => void,
  value: T,
  onError: (error: unknown) => void,
): void {
  try {
    handler(value);
  } catch (error) {
    onError(error);
  }
}
