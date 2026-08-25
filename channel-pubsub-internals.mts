import type { GlideClient, GlideString } from "@valkey/valkey-glide";

export function decrement(counts: Map<string, number>, key: string): void {
  const count = (counts.get(key) ?? 1) - 1;
  if (count <= 0) counts.delete(key);
  else counts.set(key, count);
}

export function removePending<T>(pending: Map<string, Set<T>>, key: string, state: T): void {
  const states = pending.get(key);
  if (!states) return;
  states.delete(state);
  if (states.size === 0) pending.delete(key);
}

export function getOrCreateSet<T>(map: Map<string, Set<T>>, key: string): Set<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Set<T>();
  map.set(key, created);
  return created;
}

export function removeHandler<T>(handlers: Map<string, Set<T>>, key: string, handler: T): void {
  const active = handlers.get(key);
  if (!active) return;
  active.delete(handler);
  if (active.size === 0) handlers.delete(key);
}

export function serializeForPublish<T>(
  serialize: (value: T) => string,
  value: T,
  report: (error: unknown) => void,
): string {
  try {
    return serialize(value);
  } catch (error) {
    report(error);
    throw error;
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function reportError(onError: ((error: Error) => void) | undefined, error: unknown): void {
  try {
    onError?.(toError(error));
  } catch {}
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

export async function closeSubscriberClient(
  client: GlideClient,
  pattern: string,
  timeoutMs: number,
  report: (error: unknown) => void,
): Promise<void> {
  try {
    await client.punsubscribe(new Set([pattern]), timeoutMs);
  } catch (error) {
    report(error);
  } finally {
    try {
      await Promise.resolve(client.close());
    } catch (error) {
      report(error);
    }
  }
}
