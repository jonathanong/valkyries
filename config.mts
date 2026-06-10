const DEFAULT_VALKEY_URL =
  process.env.VALKEY_URL || `redis://${process.env.DOCKER_HOST_IP || "localhost"}:6379`;

export const config = {
  // used for caching; preferReplica routes writes to primary automatically
  cache_url: process.env.VALKEY_CACHE_URL || DEFAULT_VALKEY_URL,

  // used for rate limiting; must always read from primary to avoid replica lag
  rate_limiter_url:
    process.env.VALKEY_RATE_LIMITER_URL || process.env.VALKEY_CACHE_URL || DEFAULT_VALKEY_URL,

  // used for distributed configuration
  dynamic_config_url: process.env.VALKEY_DYNAMIC_CONFIG_URL || DEFAULT_VALKEY_URL,

  inflight_requests_limit: (() => {
    const n = Number(process.env.VALKEY_INFLIGHT_REQUESTS_LIMIT);
    return Number.isFinite(n) ? n : 1000;
  })(),
  request_timeout_ms: (() => {
    const n = Number(process.env.VALKEY_REQUEST_TIMEOUT_MS);
    return Number.isFinite(n) ? n : 500;
  })(),
  inflight_retry_attempts: (() => {
    const n = Number(process.env.VALKEY_INFLIGHT_RETRY_ATTEMPTS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
  })(),
  inflight_retry_delay_ms: (() => {
    const n = Number(process.env.VALKEY_INFLIGHT_RETRY_DELAY_MS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000;
  })(),
};
