import { Buffer } from "node:buffer";
import { handleValkeyError } from "./errors.mts";
import type { GlideClient, GlideString } from "@valkey/valkey-glide";

const DEFAULT_SCAN_COUNT = 500;

export async function deleteKeysWithPrefix(client: GlideClient, pattern: string): Promise<void> {
  await scanAndUnlink(client, pattern);
}

export async function deleteKeysWithLiteralPrefixes(
  client: GlideClient,
  pattern: string,
  prefixes: readonly string[],
): Promise<void> {
  const uniquePrefixes = [...new Set<unknown>(prefixes)].filter(
    (prefix): prefix is string => typeof prefix === "string",
  );
  if (uniquePrefixes.length === 0) return;

  await scanAndUnlink(client, pattern, (key) =>
    uniquePrefixes.some((prefix) => key.startsWith(prefix)),
  );
}

async function scanAndUnlink(
  client: GlideClient,
  pattern: string,
  matches: (key: string) => boolean = () => true,
): Promise<void> {
  try {
    let cursor = "0";

    do {
      const result = await client.scan(cursor, { match: pattern, count: DEFAULT_SCAN_COUNT });
      cursor = result[0] as string;
      const keys = (result[1] as GlideString[])
        .map((key) => (typeof key === "string" ? key : Buffer.from(key).toString("utf8")))
        .filter(matches);

      if (keys.length > 0) {
        await client.unlink(keys);
      }
    } while (cursor !== "0");
  } catch (err) {
    handleValkeyError(err);
    throw err;
  }
}
