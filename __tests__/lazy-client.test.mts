import { inspect } from "node:util";
import { ClosingError, GlideClient } from "@valkey/valkey-glide";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectLazyValkeyClient, createLazyValkeyClient } from "../lazy-client.mts";

const config = { addresses: [{ host: "localhost", port: 6379 }], lazyConnect: true };

function fakeClient() {
  return {
    get: vi.fn(async (key: string) => `value:${key}`),
    close: vi.fn(),
  } as unknown as GlideClient & { get: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLazyValkeyClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("importing the package clients creates no native client", async () => {
    vi.resetModules();
    const { GlideClient: FreshGlideClient } = await import("@valkey/valkey-glide");
    const createClient = vi.spyOn(FreshGlideClient, "createClient");
    const clients = await import("../clients.mts");

    expect(clients.cacheValkeyClient).toBeInstanceOf(FreshGlideClient);
    expect(clients.rateLimiterValkeyClient).toBeInstanceOf(FreshGlideClient);
    expect(clients.dynamicConfigValkeyClient).toBeInstanceOf(FreshGlideClient);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("is a plain value: awaiting, inspecting, and serializing it do not create a client", async () => {
    const createClient = vi.spyOn(GlideClient, "createClient");
    const lazy = createLazyValkeyClient(config);

    // A thenable client would make `await upsertValkeyClientByUrl()` resolve to something else.
    await expect(Promise.resolve(lazy)).resolves.toBe(lazy);
    expect(() => inspect(lazy)).not.toThrow();
    expect(JSON.stringify(lazy)).toBe("{}");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates the native client once on the first commands and then forwards to it", async () => {
    const created = fakeClient();
    const createClient = vi.spyOn(GlideClient, "createClient").mockResolvedValue(created);
    const lazy = createLazyValkeyClient(config);

    await expect(Promise.all([lazy.get("a"), lazy.get("b")])).resolves.toEqual([
      "value:a",
      "value:b",
    ]);
    await expect(lazy.get("c")).resolves.toBe("value:c");
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(config);
    expect(created.get).toHaveBeenCalledTimes(3);
  });

  it("retries creation on the next command after a failed creation", async () => {
    const error = new Error("socket failed");
    const created = fakeClient();
    vi.spyOn(GlideClient, "createClient")
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(created);
    const lazy = createLazyValkeyClient(config);

    await expect(lazy.get("a")).rejects.toBe(error);
    await expect(lazy.get("a")).resolves.toBe("value:a");
  });

  it("close before the first command creates nothing and rejects later commands", async () => {
    const createClient = vi.spyOn(GlideClient, "createClient");
    const lazy = createLazyValkeyClient(config);

    lazy.close();
    lazy.close();

    await expect(lazy.get("a")).rejects.toBeInstanceOf(ClosingError);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("close during creation closes the native client once it is created", async () => {
    const created = fakeClient();
    const pending = deferred<GlideClient>();
    vi.spyOn(GlideClient, "createClient").mockReturnValue(pending.promise);
    const lazy = createLazyValkeyClient(config);

    const command = lazy.get("a");
    lazy.close("shutting down");
    pending.resolve(created);

    await expect(command).rejects.toBeInstanceOf(ClosingError);
    expect(created.close).toHaveBeenCalledWith("shutting down");
    expect(created.get).not.toHaveBeenCalled();
  });

  it("close after creation closes the native client", async () => {
    const created = fakeClient();
    vi.spyOn(GlideClient, "createClient").mockResolvedValue(created);
    const lazy = createLazyValkeyClient(config);

    await lazy.get("a");
    lazy.close();

    expect(created.close).toHaveBeenCalledTimes(1);
  });

  it("getStatistics works before and after creation", async () => {
    vi.spyOn(GlideClient, "createClient").mockResolvedValue(fakeClient());
    const lazy = createLazyValkeyClient(config);

    expect(lazy.getStatistics()).toBeTypeOf("object");
    await lazy.get("a");
    expect(lazy.getStatistics()).toBeTypeOf("object");
  });

  it("connectLazyValkeyClient creates the native client now", async () => {
    const createClient = vi.spyOn(GlideClient, "createClient").mockResolvedValue(fakeClient());
    const lazy = createLazyValkeyClient(config);

    await connectLazyValkeyClient(lazy);

    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("connectLazyValkeyClient ignores a client that is not lazy", async () => {
    await expect(connectLazyValkeyClient(fakeClient())).resolves.toBeUndefined();
  });
});

describe("getValkeyClientByUrl", () => {
  it("returns the same client as upsertValkeyClientByUrl for the same options", async () => {
    const { getValkeyClientByUrl, upsertValkeyClientByUrl } = await import("../clients.mts");
    const url = "redis://localhost:7390";
    const client = getValkeyClientByUrl(url, { name: "sync" });

    expect(getValkeyClientByUrl(url, { name: "sync" })).toBe(client);
    expect(getValkeyClientByUrl(url, { name: "other" })).not.toBe(client);
    await expect(upsertValkeyClientByUrl(url, { name: "sync" })).resolves.toBe(client);
  });

  it("throws synchronously for a malformed URL", async () => {
    const { getValkeyClientByUrl } = await import("../clients.mts");

    expect(() => getValkeyClientByUrl("not-a-url")).toThrow("Invalid Valkey URL");
  });
});
