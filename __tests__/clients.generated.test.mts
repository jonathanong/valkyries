import { GlideClientConfiguration } from "@valkey/valkey-glide";
import { it, expect, describe } from "vitest";
import {
  buildDynamicConfigSubscriptionClientConfig,
  glideConfigFromUrl,
  upsertValkeyClientByUrl,
} from "../clients.mts";
import { ValkeyUrlError } from "../errors.mts";

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
    let thrown: unknown;
    expect(() => glideConfigFromUrl("not-a-url")).toThrow("Invalid Valkey URL");
    try {
      glideConfigFromUrl("not-a-url");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValkeyUrlError);
    expect((thrown as Error).message).toBe("Invalid Valkey URL");
    expect((thrown as ValkeyUrlError).cause).toBeInstanceOf(Error);
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
});
