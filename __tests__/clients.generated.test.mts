import { GlideClientConfiguration } from "@valkey/valkey-glide";
import { it, expect, describe, vi, afterEach } from "vitest";
import {
  buildDynamicConfigSubscriptionClientConfig,
  glideConfigFromUrl,
  upsertValkeyClientByUrl,
} from "../clients.mts";

describe("clients.generated", () => {
  it("glideConfigFromUrl parses redis:// URL", () => {
    const config = glideConfigFromUrl("redis://localhost:6379");
    expect(config.addresses[0].host).toBe("localhost");
    expect(config.addresses[0].port).toBe(6379);
    expect(config.useTLS).toBe(false);
    expect(config.credentials).toBeUndefined();
  });

  it("glideConfigFromUrl parses rediss:// URL with TLS", () => {
    const config = glideConfigFromUrl("rediss://localhost:6380");
    expect(config.addresses[0].host).toBe("localhost");
    expect(config.addresses[0].port).toBe(6380);
    expect(config.useTLS).toBe(true);
  });

  it("glideConfigFromUrl uses default port 6379 when not specified", () => {
    const config = glideConfigFromUrl("redis://localhost");
    expect(config.addresses[0].port).toBe(6379);
  });

  it("glideConfigFromUrl parses URL with credentials", () => {
    const config = glideConfigFromUrl("redis://user:pass@localhost:6379");
    expect(config.credentials).toEqual({
      username: "user",
      password: "pass",
    });
  });

  it("glideConfigFromUrl parses URL with password only", () => {
    const config = glideConfigFromUrl("redis://:pass@localhost:6379");
    expect(config.credentials).toEqual({
      password: "pass",
    });
  });

  it("glideConfigFromUrl decodes percent-encoded credentials", () => {
    const config = glideConfigFromUrl("redis://user%40name:p%40ss%3Aword@localhost:6379");
    expect(config.credentials).toEqual({
      username: "user@name",
      password: "p@ss:word",
    });
  });

  it("glideConfigFromUrl treats username-only URL as unauthenticated", () => {
    // URLs with username but no password cannot form valid Valkey credentials (library requires password)
    // so credentials are omitted entirely, treating the connection as unauthenticated.
    const config = glideConfigFromUrl("redis://user@localhost:6379");
    expect(config.credentials).toBeUndefined();
  });

  it("glideConfigFromUrl throws error for invalid URL", () => {
    expect(() => glideConfigFromUrl("not-a-url")).toThrow("Invalid Valkey URL");
  });

  it("glideConfigFromUrl allows overriding lazy connect", () => {
    const config = glideConfigFromUrl("redis://localhost:6379", { lazyConnect: false });
    expect(config.lazyConnect).toBe(false);
  });

  it("buildDynamicConfigSubscriptionClientConfig uses eager connect for pubsub", () => {
    const config = buildDynamicConfigSubscriptionClientConfig("redis://localhost:6379");
    expect(config.lazyConnect).toBe(false);
    expect(
      config.pubsubSubscriptions.channelsAndPatterns[
        GlideClientConfiguration.PubSubChannelModes.Pattern
      ],
    ).toEqual(new Set(["dynamic-config:*"]));
  });

  it("upsertValkeyClientByUrl returns same client for same URL", async () => {
    const url = "redis://localhost:7379";
    const client1 = await upsertValkeyClientByUrl(url);
    const client2 = await upsertValkeyClientByUrl(url);
    expect(client1).toBe(client2);
  });

  it("upsertValkeyClientByUrl deduplicates concurrent calls for same URL", async () => {
    const url = "redis://localhost:7379";
    const [client1, client2, client3] = await Promise.all([
      upsertValkeyClientByUrl(url, { readFrom: "primary" }),
      upsertValkeyClientByUrl(url, { readFrom: "primary" }),
      upsertValkeyClientByUrl(url, { readFrom: "primary" }),
    ]);
    expect(client1).toBe(client2);
    expect(client2).toBe(client3);
  });

  it("upsertValkeyClientByUrl returns different clients for different URLs", async () => {
    const url1 = "redis://localhost:7380";
    const url2 = "redis://localhost:7381";
    const client1 = await upsertValkeyClientByUrl(url1);
    const client2 = await upsertValkeyClientByUrl(url2);
    expect(client1).not.toBe(client2);
  });

  it("glideConfigFromUrl includes default inflightRequestsLimit and requestTimeout", () => {
    const cfg = glideConfigFromUrl("redis://localhost:6379");
    expect(cfg.inflightRequestsLimit).toBe(1000);
    expect(cfg.requestTimeout).toBe(500);
  });

  it("glideConfigFromUrl reflects per-call inflightRequestsLimit and requestTimeout overrides", () => {
    const cfg = glideConfigFromUrl("redis://localhost:6379", {
      inflightRequestsLimit: 2000,
      requestTimeout: 1000,
    });
    expect(cfg.inflightRequestsLimit).toBe(2000);
    expect(cfg.requestTimeout).toBe(1000);
  });

  it("upsertValkeyClientByUrl creates separate clients for different inflightRequestsLimit", async () => {
    const url = "redis://localhost:7382";
    const client1 = await upsertValkeyClientByUrl(url, { inflightRequestsLimit: 500 });
    const client2 = await upsertValkeyClientByUrl(url, { inflightRequestsLimit: 2000 });
    expect(client1).not.toBe(client2);
  });

  describe("env-based config defaults", () => {
    afterEach(() => {
      delete process.env.VALKEY_INFLIGHT_REQUESTS_LIMIT;
      delete process.env.VALKEY_REQUEST_TIMEOUT_MS;
    });

    it("config reads VALKEY_INFLIGHT_REQUESTS_LIMIT and VALKEY_REQUEST_TIMEOUT_MS from env", async () => {
      process.env.VALKEY_INFLIGHT_REQUESTS_LIMIT = "2000";
      process.env.VALKEY_REQUEST_TIMEOUT_MS = "750";
      vi.resetModules();
      const { config } = await import("../config.mts");
      expect(config.inflight_requests_limit).toBe(2000);
      expect(config.request_timeout_ms).toBe(750);
    });
  });
});
