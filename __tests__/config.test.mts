import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should use default fallback values when no env vars are set", async () => {
    vi.unstubAllEnvs(); // Make sure they are totally undefined, not empty strings

    // Explicitly delete standard process.env keys that might be set by the system
    delete process.env.VALKEY_URL;
    delete process.env.VALKEY_CACHE_URL;
    delete process.env.VALKEY_RATE_LIMITER_URL;
    delete process.env.VALKEY_DYNAMIC_CONFIG_URL;

    const { config } = await import("../config.mts");
    expect(config.cache_url).toBe("valkey://localhost:6379");
    expect(config.rate_limiter_url).toBe("valkey://localhost:6379");
    expect(config.dynamic_config_url).toBe("valkey://localhost:6379");
  });

  it("should use VALKEY_URL when provided, overriding default", async () => {
    vi.stubEnv("VALKEY_URL", "valkey://valkey-server:6379");

    delete process.env.VALKEY_CACHE_URL;
    delete process.env.VALKEY_RATE_LIMITER_URL;
    delete process.env.VALKEY_DYNAMIC_CONFIG_URL;

    const { config } = await import("../config.mts");
    expect(config.cache_url).toBe("valkey://valkey-server:6379");
    expect(config.rate_limiter_url).toBe("valkey://valkey-server:6379");
    expect(config.dynamic_config_url).toBe("valkey://valkey-server:6379");
  });

  it("should prioritize specific URLs over VALKEY_URL", async () => {
    vi.stubEnv("VALKEY_URL", "valkey://valkey-server:6379");
    vi.stubEnv("VALKEY_CACHE_URL", "valkey://cache:6379");
    vi.stubEnv("VALKEY_RATE_LIMITER_URL", "valkey://rate:6379");
    vi.stubEnv("VALKEY_DYNAMIC_CONFIG_URL", "valkey://config:6379");

    const { config } = await import("../config.mts");
    expect(config.cache_url).toBe("valkey://cache:6379");
    expect(config.rate_limiter_url).toBe("valkey://rate:6379");
    expect(config.dynamic_config_url).toBe("valkey://config:6379");
  });

  it("should parse inflight_requests_limit correctly", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_REQUESTS_LIMIT", "2000");
    const { config } = await import("../config.mts");
    expect(config.inflight_requests_limit).toBe(2000);
  });

  it("should fallback inflight_requests_limit on invalid value", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_REQUESTS_LIMIT", "invalid");
    const { config } = await import("../config.mts");
    expect(config.inflight_requests_limit).toBe(1000);
  });

  it("should parse request_timeout_ms correctly", async () => {
    vi.stubEnv("VALKEY_REQUEST_TIMEOUT_MS", "1500");
    const { config } = await import("../config.mts");
    expect(config.request_timeout_ms).toBe(1500);
  });

  it("should fallback request_timeout_ms on invalid value", async () => {
    vi.stubEnv("VALKEY_REQUEST_TIMEOUT_MS", "invalid");
    const { config } = await import("../config.mts");
    expect(config.request_timeout_ms).toBe(500);
  });

  it("should parse inflight_retry_attempts correctly", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_ATTEMPTS", "5");
    const { config } = await import("../config.mts");
    expect(config.inflight_retry_attempts).toBe(5);
  });

  it("should parse and floor decimal inflight_retry_attempts", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_ATTEMPTS", "5.9");
    const { config } = await import("../config.mts");
    expect(config.inflight_retry_attempts).toBe(5);
  });

  it("should fallback inflight_retry_attempts on invalid or non-positive value", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_ATTEMPTS", "0");
    let { config } = await import("../config.mts");
    expect(config.inflight_retry_attempts).toBe(3);

    vi.resetModules();
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_ATTEMPTS", "-1");
    ({ config } = await import("../config.mts"));
    expect(config.inflight_retry_attempts).toBe(3);

    vi.resetModules();
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_ATTEMPTS", "invalid");
    ({ config } = await import("../config.mts"));
    expect(config.inflight_retry_attempts).toBe(3);
  });

  it("should parse inflight_retry_delay_ms correctly", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_DELAY_MS", "2000");
    const { config } = await import("../config.mts");
    expect(config.inflight_retry_delay_ms).toBe(2000);
  });

  it("should parse and floor decimal inflight_retry_delay_ms", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_DELAY_MS", "2000.5");
    const { config } = await import("../config.mts");
    expect(config.inflight_retry_delay_ms).toBe(2000);
  });

  it("should fallback inflight_retry_delay_ms on invalid or non-positive value", async () => {
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_DELAY_MS", "0");
    let { config } = await import("../config.mts");
    expect(config.inflight_retry_delay_ms).toBe(1000);

    vi.resetModules();
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_DELAY_MS", "-500");
    ({ config } = await import("../config.mts"));
    expect(config.inflight_retry_delay_ms).toBe(1000);

    vi.resetModules();
    vi.stubEnv("VALKEY_INFLIGHT_RETRY_DELAY_MS", "invalid");
    ({ config } = await import("../config.mts"));
    expect(config.inflight_retry_delay_ms).toBe(1000);
  });
});
