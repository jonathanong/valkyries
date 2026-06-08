import { describe, expect, it } from "vitest";
import { GlideClientConfiguration } from "@valkey/valkey-glide";
import { buildDynamicConfigSubscriptionClientConfig } from "../clients.mts";

describe("buildDynamicConfigSubscriptionClientConfig", () => {
  it("builds correct config for valid URL", () => {
    const url = "redis://localhost:6379";
    const config = buildDynamicConfigSubscriptionClientConfig(url);

    expect(config.addresses).toEqual([{ host: "localhost", port: 6379 }]);
    expect(config.useTLS).toBe(false);
    expect(config.credentials).toBeUndefined();
    expect(config.readFrom).toBe("preferReplica");
    expect(config.lazyConnect).toBe(false);
    expect(config.inflightRequestsLimit).toBeDefined();
    expect(config.requestTimeout).toBeDefined();

    expect(config.pubsubSubscriptions).toBeDefined();
    expect(config.pubsubSubscriptions?.channelsAndPatterns).toBeDefined();
    expect(
      config.pubsubSubscriptions?.channelsAndPatterns?.[
        GlideClientConfiguration.PubSubChannelModes.Pattern
      ],
    ).toEqual(new Set(["dynamic-config:*"]));

    expect(config.pubsubSubscriptions?.callback).toBeDefined();
    expect(typeof config.pubsubSubscriptions?.callback).toBe("function");
  });

  it("handles valid URLs with credentials", () => {
    const url = "redis://user:password@localhost:6379";
    const config = buildDynamicConfigSubscriptionClientConfig(url);
    expect(config.credentials).toEqual({ username: "user", password: "password" });
  });

  it("handles rediss (TLS) scheme", () => {
    const url = "rediss://localhost:6379";
    const config = buildDynamicConfigSubscriptionClientConfig(url);
    expect(config.useTLS).toBe(true);
  });

  it("throws error for invalid URL", () => {
    expect(() => buildDynamicConfigSubscriptionClientConfig("not-a-url")).toThrow(
      "Invalid Valkey URL: not-a-url",
    );
  });
});
