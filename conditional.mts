import { cacheValkeyClient } from "./clients.mts";
import { loadScript, registerScript } from "./scripts.mts";
import { Decoder, type GlideClient } from "@valkey/valkey-glide";

const unlinkIfValueMatchesScript = registerScript(
  loadScript("unlink-if-value-matches.lua", import.meta.url),
);

export type UnlinkIfValueMatchesOptions = {
  /** Optional Valkey client. Defaults to the package cache client. */
  client?: GlideClient;
};

/** Atomically unlinks a key only when its stored string value matches the expected value. */
export async function unlinkIfValueMatches(
  key: string,
  expectedValue: string,
  options: UnlinkIfValueMatchesOptions = {},
): Promise<boolean> {
  if (!key) throw new Error("key must not be empty");

  const result = await (options.client ?? cacheValkeyClient).invokeScript(
    unlinkIfValueMatchesScript,
    {
      keys: [key],
      args: [expectedValue],
      decoder: Decoder.String,
    },
  );

  if (result === 1 || result === 1n) return true;
  if (result === 0 || result === 0n) return false;
  throw new Error(`Unexpected conditional unlink result: ${stringifyValkeyResult(result)}`);
}

function stringifyValkeyResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "bigint" || typeof result === "boolean") {
    return result.toString();
  }
  return JSON.stringify(result) ?? "[unserializable]";
}
