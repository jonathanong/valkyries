const DEFAULT_VALKEY_URL = `valkey://${process.env.DOCKER_HOST_IP || "localhost"}:6379`;

const resolveUrl = (url?: string, ...urls: Array<string | undefined>) =>
  [url, ...urls].find((entry) => typeof entry === "string" && entry.length > 0) ?? DEFAULT_VALKEY_URL;

export const config = {
  cache_url: resolveUrl(process.env.VALKEY_CACHE_URL, process.env.VALKEY_URL),
  rate_limiter_url: resolveUrl(
    process.env.VALKEY_RATE_LIMITER_URL,
    process.env.VALKEY_CACHE_URL,
    process.env.VALKEY_URL,
  ),
  dynamic_config_url: resolveUrl(process.env.VALKEY_DYNAMIC_CONFIG_URL, process.env.VALKEY_URL),

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
