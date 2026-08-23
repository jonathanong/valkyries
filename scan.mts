import { Buffer } from "node:buffer";
import { Decoder, type GlideClient, type GlideString } from "@valkey/valkey-glide";

type ScanKeyPagesOptions = {
  count: number;
  signal?: AbortSignal;
};

export async function* scanKeyPages(
  client: GlideClient,
  pattern: string,
  { count, signal }: ScanKeyPagesOptions,
): AsyncGenerator<GlideString[]> {
  let cursor = "0";
  do {
    throwIfAborted(signal);
    const [nextCursor, keys] = await client.scan(cursor, {
      match: pattern,
      count,
      decoder: Decoder.Bytes,
    });
    throwIfAborted(signal);
    cursor = keyToString(nextCursor);
    yield keys;
  } while (cursor !== "0");
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason;
}

function keyToString(key: GlideString): string {
  return typeof key === "string" ? key : Buffer.from(key).toString("utf8");
}
