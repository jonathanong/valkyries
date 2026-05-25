import { rateLimiterValkeyClient } from "./clients.mts";
import { loadScript, registerScript } from "./scripts.mts";
import type { RateLimiterOptions } from "./types.mts";
import type { GlideClient } from "@valkey/valkey-glide";
import { randomUUID } from "node:crypto";
import { deleteKeysWithPrefix } from "./delete.mts";
import { emitValkeyEvent } from "./events.mts";
import { normalizeCountResult } from "./utils.mts";
import { handleValkeyError, RateLimiterConfigurationError } from "./errors.mts";

const NAMESPACE = "rate-limiter";

const rateLimiterAddScript = registerScript(loadScript("rate-limiter-add.lua", import.meta.url));
const rateLimiterGetScript = registerScript(loadScript("rate-limiter-get.lua", import.meta.url));
const rateLimiterAddAndCheckScript = registerScript(
  loadScript("rate-limiter-add-and-check.lua", import.meta.url),
);

export class RateLimiter {
  prefix: string;
  ttl: number;
  private client: GlideClient;

  constructor({ prefix, ttlSeconds, client = rateLimiterValkeyClient }: RateLimiterOptions) {
    if (!prefix?.trim()) throw new RateLimiterConfigurationError("prefix is required");
    if (!(ttlSeconds > 0 && Number.isFinite(ttlSeconds)))
      throw new RateLimiterConfigurationError("ttlSeconds must be greater than 0");
    this.prefix = prefix;
    this.ttl = ttlSeconds;
    this.client = client;
  }

  async add(ids: string[]) {
    // ⚡ Bolt Optimization:
    // What: Replace .filter().map() chain with a single indexed loop.
    // Why: Avoids creating intermediate arrays and iterator overhead in a hot path.
    // Impact: Reduces GC pressure and improves throughput.
    const filteredIds: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id) {
        filteredIds.push(id);
        keys.push(this.getKey(id));
      }
    }
    if (filteredIds.length === 0) return;
    // Single script call for all keys (server time is used in script)
    // Use CSPRNG to prevent predictability and collisions.
    // Optimization: Generate one UUID and append index to avoid calling CSPRNG N times.
    const base = randomUUID();
    const args: string[] = [];
    args.length = keys.length + 1;
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
    // ⚡ Bolt Optimization:
    // What: Replace .filter().map() chain with a single indexed loop.
    // Why: Avoids creating intermediate arrays and iterator overhead in a hot path.
    // Impact: Reduces GC pressure and improves throughput.
    const filteredIds: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id) {
        filteredIds.push(id);
        keys.push(this.getKey(id));
      }
    }
    if (filteredIds.length === 0) return { counts: [], limited: false };
    // Use CSPRNG to prevent predictability and collisions.
    // Optimization: Generate one UUID and append index to avoid calling CSPRNG N times.
    const base = randomUUID();
    const args: string[] = [];
    args.length = keys.length + 1;
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
    // ⚡ Bolt Optimization:
    // What: Replace .filter().map() chain with a single indexed loop.
    // Why: Avoids creating intermediate arrays and iterator overhead in a hot path.
    // Impact: Reduces GC pressure and improves throughput.
    const filteredIds: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id) {
        filteredIds.push(id);
        keys.push(this.getKey(id));
      }
    }
    if (filteredIds.length === 0) return [];
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
    // ⚡ Bolt Optimization:
    // What: Replace .filter().map() chain with a single indexed loop.
    // Why: Avoids creating intermediate arrays and iterator overhead in a hot path.
    // Impact: Reduces GC pressure and improves throughput.
    const filteredIds: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id) {
        filteredIds.push(id);
        keys.push(this.getKey(id));
      }
    }
    if (filteredIds.length === 0) return 0;
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
}
