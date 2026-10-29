// Bun embeds these files in `bun build --compile` executables; Node reads them from disk instead.
import bloomFilterAdd from "./scripts/bloom-filter-add.lua" with { type: "text" };
import bloomFilterEnsureExists from "./scripts/bloom-filter-ensure-exists.lua" with { type: "text" };
import bloomFilterExistsIfReady from "./scripts/bloom-filter-exists-if-ready.lua" with { type: "text" };
import bloomFilterExists from "./scripts/bloom-filter-exists.lua" with { type: "text" };
import bloomFilterMexistsIfReady from "./scripts/bloom-filter-mexists-if-ready.lua" with { type: "text" };
import bloomFilterMexists from "./scripts/bloom-filter-mexists.lua" with { type: "text" };
import bloomFilterReserve from "./scripts/bloom-filter-reserve.lua" with { type: "text" };
import cacheDeleteWithInvalidation from "./scripts/cache-delete-with-invalidation.lua" with { type: "text" };
import cacheSetIfNotInvalidated from "./scripts/cache-set-if-not-invalidated.lua" with { type: "text" };
import dynamicConfigSetFields from "./scripts/dynamic-config-set-fields.lua" with { type: "text" };
import getValueWithTtl from "./scripts/get-value-with-ttl.lua" with { type: "text" };
import getValuesWithTtl from "./scripts/get-values-with-ttl.lua" with { type: "text" };
import idempotencyKeyCompleteIfCurrent from "./scripts/idempotency-key-complete-if-current.lua" with { type: "text" };
import idempotencyKeyReleaseIfCurrent from "./scripts/idempotency-key-release-if-current.lua" with { type: "text" };
import idempotencyKeyReserve from "./scripts/idempotency-key-reserve.lua" with { type: "text" };
import pexpireIfValueMatches from "./scripts/pexpire-if-value-matches.lua" with { type: "text" };
import rateLimiterAddAndCheckWindows from "./scripts/rate-limiter-add-and-check-windows.lua" with { type: "text" };
import rateLimiterAddAndCheck from "./scripts/rate-limiter-add-and-check.lua" with { type: "text" };
import rateLimiterAdd from "./scripts/rate-limiter-add.lua" with { type: "text" };
import rateLimiterConsume from "./scripts/rate-limiter-consume.lua" with { type: "text" };
import rateLimiterGet from "./scripts/rate-limiter-get.lua" with { type: "text" };
import unlinkIfValueMatches from "./scripts/unlink-if-value-matches.lua" with { type: "text" };

export const luaSources: Readonly<Record<string, string>> = {
  "bloom-filter-add.lua": bloomFilterAdd,
  "bloom-filter-ensure-exists.lua": bloomFilterEnsureExists,
  "bloom-filter-exists-if-ready.lua": bloomFilterExistsIfReady,
  "bloom-filter-exists.lua": bloomFilterExists,
  "bloom-filter-mexists-if-ready.lua": bloomFilterMexistsIfReady,
  "bloom-filter-mexists.lua": bloomFilterMexists,
  "bloom-filter-reserve.lua": bloomFilterReserve,
  "cache-delete-with-invalidation.lua": cacheDeleteWithInvalidation,
  "cache-set-if-not-invalidated.lua": cacheSetIfNotInvalidated,
  "dynamic-config-set-fields.lua": dynamicConfigSetFields,
  "get-value-with-ttl.lua": getValueWithTtl,
  "get-values-with-ttl.lua": getValuesWithTtl,
  "idempotency-key-complete-if-current.lua": idempotencyKeyCompleteIfCurrent,
  "idempotency-key-release-if-current.lua": idempotencyKeyReleaseIfCurrent,
  "idempotency-key-reserve.lua": idempotencyKeyReserve,
  "pexpire-if-value-matches.lua": pexpireIfValueMatches,
  "rate-limiter-add-and-check-windows.lua": rateLimiterAddAndCheckWindows,
  "rate-limiter-add-and-check.lua": rateLimiterAddAndCheck,
  "rate-limiter-add.lua": rateLimiterAdd,
  "rate-limiter-consume.lua": rateLimiterConsume,
  "rate-limiter-get.lua": rateLimiterGet,
  "unlink-if-value-matches.lua": unlinkIfValueMatches,
};
