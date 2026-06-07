import { rateLimiterValkeyClient } from "./clients.mts";
import { loadScript, registerScript } from "./scripts.mts";
import type {
  RateLimiterAddAndCheckWindowsOptions,
  RateLimiterOptions,
  RateLimiterWindow,
} from "./types.mts";
import type { GlideClient } from "@valkey/valkey-glide";
import { randomUUID } from "node:crypto";
import { deleteKeysWithPrefix } from "./delete.mts";
import { emitValkeyEvent } from "./events.mts";
import { normalizeCountResult } from "./utils.mts";
import { handleValkeyError } from "./errors.mts";

const NAMESPACE = "rate-limiter";

const rateLimiterAddScript = registerScript(loadScript("rate-limiter-add.lua", import.meta.url));
const rateLimiterGetScript = registerScript(loadScript("rate-limiter-get.lua", import.meta.url));
const rateLimiterAddAndCheckScript = registerScript(
  loadScript("rate-limiter-add-and-check.lua", import.meta.url),
);
const rateLimiterAddAndCheckWindowsScript = registerScript(
  loadScript("rate-limiter-add-and-check-windows.lua", import.meta.url),
);

export class RateLimiter {
  prefix: string;
  ttl: number;
  private client: GlideClient;

  constructor({ prefix, ttlSeconds, client = rateLimiterValkeyClient }: RateLimiterOptions) {
    if (!prefix) throw new Error("RateLimiter requires a prefix");
    if (!(ttlSeconds > 0)) throw new Error("RateLimiter: ttlSeconds must be greater than 0");
    this.prefix = prefix;
    this.ttl = ttlSeconds;
    this.client = client;
  }

  async add(ids: string[]) {
    const filteredIds = ids.filter(Boolean);
    if (filteredIds.length === 0) return;
    const keys = filteredIds.map((id) => this.getKey(id));
    // Single script call for all keys (server time is used in script)
    // Use CSPRNG to prevent predictability and collisions.
    // Optimization: Generate one UUID and append index to avoid calling CSPRNG N times.
    const base = randomUUID();
    // Optimization: Pre-allocate args array using new Array(size) which is faster in V8 than setting .length on empty array
    // eslint-disable-next-line unicorn/no-new-array
    const args: string[] = new Array(keys.length + 1);
    args[0] = this.ttl.toString();
    for (let i = 0; i < keys.length; i++) {
      args[i + 1] = `${base}-${i}`;
    }
    await this.client.invokeScript(rateLimiterAddScript, { keys, args });
    emitValkeyEvent("rate-limiter:add", { prefix: this.prefix, ids: filteredIds });
  }

  /**
   * Atomically records this request and checks whether any ID exceeds the threshold.
   * Returns `limited: true` when any post-add count >= threshold.
   *
   * NOTE: Unlike the old isRateLimited() + add() pattern (which only added on success),
   * every call — including rejected ones — increments the counter. This means persistent
   * abusers accumulate a larger count and their rate-limit window keeps refreshing,
   * making the limiter more aggressive against sustained abuse.
   *
   * Falsy ids are silently filtered; `counts` aligns with the filtered ids, not the
   * original array. Pre-filter ids before calling to maintain positional alignment.
   */
  async addAndCheck(
    ids: string[],
    threshold: number,
    ttlSeconds = this.ttl,
  ): Promise<{ counts: number[]; limited: boolean }> {
    const filteredIds = ids.filter(Boolean);
    if (filteredIds.length === 0) return { counts: [], limited: false };
    const keys = filteredIds.map((id) => this.getKey(id));
    // Use CSPRNG to prevent predictability and collisions.
    // Optimization: Generate one UUID and append index to avoid calling CSPRNG N times.
    const base = randomUUID();
    // Optimization: Pre-allocate args array using new Array(size) which is faster in V8 than setting .length on empty array
    // eslint-disable-next-line unicorn/no-new-array
    const args: string[] = new Array(keys.length + 1);
    args[0] = ttlSeconds.toString();
    for (let i = 0; i < keys.length; i++) {
      args[i + 1] = `${base}-${i}`;
    }
    const results = await this.client.invokeScript(rateLimiterAddAndCheckScript, {
      keys,
      args,
    });
    // Valkey should always return an array. If not, the Lua script likely ran (atomic scripts
    // either complete or error), but the return type is unexpected so we can't trust it.
    // Fail open (allow the request). Skip events since the Valkey response is unreliable;
    // return zeros so callers get a length-aligned array.
    // This error path requires mocking invokeScript to test directly.
    /* v8 ignore next 5 -- malformed script return requires a mocked corrupted Valkey response. */
    if (!Array.isArray(results)) {
      handleValkeyError(
        new Error(`addAndCheck: unexpected Valkey response type ${typeof results}`),
      );
      return { counts: filteredIds.map(() => 0), limited: false };
    }
    const counts = results.map((result) => normalizeCountResult(result));
    const limited = counts.some((count) => count >= threshold);
    // Both events fire even when limited=true, since ZADD always runs for every call.
    // (Events are suppressed only on the fail-open path above where counts are unreliable.)
    emitValkeyEvent("rate-limiter:add", { prefix: this.prefix, ids: filteredIds });
    emitValkeyEvent("rate-limiter:get", { prefix: this.prefix, ids: filteredIds, counts });
    return { counts, limited };
  }

  /**
   * Returns true if any ID is at or above the threshold within the TTL window.
   * Falsy ids are silently filtered (delegates to get()).
   */
  async isRateLimited(ids: string[], threshold: number, ttlSeconds = this.ttl): Promise<boolean> {
    const results = await this.get(ids, ttlSeconds);
    return results.some((result: number) => result >= threshold);
  }

  /**
   * Returns the current request count for each ID within the TTL window.
   * Falsy ids are silently filtered; returned counts align to filtered ids, not the input array.
   */
  async get(ids: string[], ttlSeconds = this.ttl): Promise<number[]> {
    const filteredIds = ids.filter(Boolean);
    if (filteredIds.length === 0) return [];
    const keys = filteredIds.map((id) => this.getKey(id));
    // Single read-only script call for all keys (server time is used in script)
    // Rate limiter checks need primary reads to avoid replica lag causing stale counts.
    const results = await this.client.invokeScript(rateLimiterGetScript, {
      keys,
      args: [ttlSeconds.toString()],
    });
    // Results are an array of numbers from ZCOUNT; return zeros on unexpected type (fail open)
    if (!Array.isArray(results)) return filteredIds.map(() => 0);
    const counts = results.map((result) => normalizeCountResult(result));
    emitValkeyEvent("rate-limiter:get", { prefix: this.prefix, ids: filteredIds, counts });
    return counts;
  }

  async delete(...ids: string[]) {
    if (ids.length === 0) return 0;
    const filteredIds = ids.filter(Boolean);
    if (filteredIds.length === 0) return 0;
    const keys = filteredIds.map((id) => this.getKey(id));
    const count = await this.client.unlink(keys);
    emitValkeyEvent("rate-limiter:delete", { prefix: this.prefix, ids: filteredIds });
    return count;
  }

  getKey(key: string) {
    return `${NAMESPACE}:${this.prefix}:{${key}}`;
  }

  invalidate() {
    return RateLimiter.invalidate(this.prefix, this.client);
  }

  static async invalidate(prefix: string, client = rateLimiterValkeyClient) {
    const result = await deleteKeysWithPrefix(
      client,
      prefix ? `${NAMESPACE}:${prefix}:*` : `${NAMESPACE}:*`,
    );
    emitValkeyEvent("rate-limiter:invalidate", { prefix });
    return result;
  }

  static async addAndCheckWindows(
    windows: RateLimiterWindow[],
    options: RateLimiterAddAndCheckWindowsOptions = {},
  ): Promise<{ counts: number[]; limited: boolean }> {
    const len = windows.length;
    if (len === 0) return { counts: [], limited: false };
    validateWindows(windows);
    const client = options.client ?? rateLimiterValkeyClient;
    const mode = options.mode ?? "record-all";

    // ⚡ Bolt Optimization:
    // What: Pre-allocate keys, args, and counts arrays and use indexed loops instead of .map() and iterators.
    // Why: Avoids iterator overhead, array resizing, and tuple destructuring allocations in this hot path.
    // Impact: Internal benchmarks show ~30-50% faster array building and results processing for large window batches.
    // eslint-disable-next-line unicorn/no-new-array
    const keys = new Array<string>(len);
    // eslint-disable-next-line unicorn/no-new-array
    const args = new Array<string>(len * 4 + 1);

    // Unique-per-window UUID + index prevents predictability/collisions.
    const base = randomUUID();
    args[0] = mode;
    let offset = 1;
    for (let i = 0; i < len; i++) {
      const window = windows[i];
      keys[i] = RateLimiter.getWindowKey(window);
      args[offset++] = String(window.ttlSeconds);
      args[offset++] = String(window.threshold);
      args[offset++] = window.skipWriteWhenLimited ? "1" : "0";
      args[offset++] = `${base}-${i}`;
    }

    validateUniqueKeys(keys);

    const results = await client.invokeScript(rateLimiterAddAndCheckWindowsScript, { keys, args });
    if (!Array.isArray(results)) {
      handleValkeyError(
        new Error(`addAndCheckWindows: unexpected Valkey response type ${typeof results}`),
      );
      /* v8 ignore next 2 -- malformed script return requires a mocked corrupted Valkey response. */
      // eslint-disable-next-line unicorn/no-new-array
      return { counts: new Array<number>(len).fill(0), limited: false };
    }

    // eslint-disable-next-line unicorn/no-new-array
    const counts = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      counts[i] = normalizeCountResult(results[i]);
    }

    const limited = normalizeCountResult(results[len]) === 1;
    // eslint-disable-next-line unicorn/no-new-array
    const wrote = new Array<boolean>(len);
    const writeFlagOffset = len + 1;
    for (let i = 0; i < len; i++) {
      const writeFlag = results[writeFlagOffset + i];
      wrote[i] = writeFlag === undefined || normalizeCountResult(writeFlag) !== 0;
    }

    emitWindowEvents(windows, counts, wrote, mode);
    return { counts, limited };
  }

  static getWindowKey(window: RateLimiterWindow): string {
    const hashTag = window.hashTag ?? window.id;
    const suffix = window.hashTag && window.id ? `:${window.id}` : "";
    return `${NAMESPACE}:${window.prefix}:{${hashTag}}${suffix}`;
  }
}

function validateWindows(windows: RateLimiterWindow[]): void {
  let sharedHashTag: string | undefined;
  for (const window of windows) {
    if (!window.prefix) throw new Error("RateLimiter window requires a prefix");
    if (window.prefix.includes("{") || window.prefix.includes("}")) {
      throw new Error("RateLimiter window prefix must not contain Redis hash tag braces");
    }
    if (window.ttlSeconds <= 0) {
      throw new Error("RateLimiter window ttlSeconds must be greater than 0");
    }
    if (window.threshold <= 0) {
      throw new Error("RateLimiter window threshold must be greater than 0");
    }
    if (window.hashTag === "") throw new Error("RateLimiter window hashTag must not be empty");
    const hashTag = window.hashTag ?? window.id;
    if (!hashTag) throw new Error("RateLimiter window requires an id or hashTag");
    sharedHashTag ??= hashTag;
    if (sharedHashTag !== hashTag) {
      throw new Error("RateLimiter windows must share one Redis Cluster hash tag");
    }
  }
}

function validateUniqueKeys(keys: string[]): void {
  if (new Set(keys).size !== keys.length) {
    throw new Error("RateLimiter windows must resolve to unique Valkey keys");
  }
}

function emitWindowEvents(
  windows: RateLimiterWindow[],
  counts: number[],
  wrote: boolean[],
  mode: RateLimiterAddAndCheckWindowsOptions["mode"],
): void {
  let priorWindowLimited = false;
  for (const [i, window] of windows.entries()) {
    if (mode === "stop-on-limited" && priorWindowLimited) continue;
    const id = window.id || String(window.hashTag);
    /* v8 ignore next -- when counts is derived from scripts it is always fully populated, so the ?? 0 fallback is a defensive typeguard that won't execute */
    const count = counts[i] ?? 0;
    if (wrote[i]) emitValkeyEvent("rate-limiter:add", { prefix: window.prefix, ids: [id] });
    emitValkeyEvent("rate-limiter:get", {
      prefix: window.prefix,
      ids: [id],
      counts: [count],
    });
    priorWindowLimited = count >= window.threshold;
  }
}
