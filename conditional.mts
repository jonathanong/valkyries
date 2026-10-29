import { cacheValkeyClient } from "./clients.mts";
import { loadPackageScript } from "./package-scripts.mts";
import { registerScript } from "./scripts.mts";
import { stringifyValkeyResult } from "./valkey-result.mts";
import type { GlideClient } from "@valkey/valkey-glide";

const unlinkIfValueMatchesScript = registerScript(loadPackageScript("unlink-if-value-matches.lua"));

const pexpireIfValueMatchesScript = registerScript(
  loadPackageScript("pexpire-if-value-matches.lua"),
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
    },
  );

  if (result === 1 || result === 1n) return true;
  if (result === 0 || result === 0n) return false;
  throw new Error(`Unexpected conditional unlink result: ${stringifyValkeyResult(result)}`);
}

/** Atomically sets a millisecond TTL on a key only when its stored string value matches. */
export async function pexpireIfValueMatches(
  key: string,
  expectedValue: string,
  ttlMs: number,
  options: UnlinkIfValueMatchesOptions = {},
): Promise<boolean> {
  if (!key) throw new Error("key must not be empty");
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("ttlMs must be a positive safe integer");
  }

  const result = await (options.client ?? cacheValkeyClient).invokeScript(
    pexpireIfValueMatchesScript,
    {
      keys: [key],
      args: [expectedValue, String(ttlMs)],
    },
  );

  if (result === 1 || result === 1n) return true;
  if (result === 0 || result === 0n) return false;
  throw new Error(`Unexpected conditional pexpire result: ${stringifyValkeyResult(result)}`);
}
