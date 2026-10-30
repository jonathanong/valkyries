import { ClosingError, GlideClient } from "@valkey/valkey-glide";

type GlideClientConfig = Parameters<typeof GlideClient.createClient>[0];
type Method = (...args: unknown[]) => unknown;

const CLOSED_MESSAGE =
  "Unable to execute requests; the client is closed. Please create a new client.";

const methodNames = collectMethodNames();
const connectors = new WeakMap<GlideClient, () => Promise<GlideClient>>();

function collectMethodNames(): string[] {
  const names = new Set<string>();
  for (
    let proto: object = GlideClient.prototype;
    proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (name !== "constructor" && typeof descriptor.value === "function") names.add(name);
    }
  }
  return [...names];
}

/**
 * Returns a `GlideClient` that is usable immediately: the native client is created on its first
 * command, so callers need no top-level await. Concurrent first commands share one creation, and a
 * failed creation is retried by the next command.
 */
export function createLazyValkeyClient(config: GlideClientConfig): GlideClient {
  let client: GlideClient | undefined;
  let creating: Promise<GlideClient> | undefined;
  let closed: { message?: string } | undefined;

  const connect = (): Promise<GlideClient> => {
    if (client) return Promise.resolve(client);
    if (closed) return Promise.reject(new ClosingError(CLOSED_MESSAGE));
    creating ??= GlideClient.createClient(config).then(
      (created) => {
        creating = undefined;
        // close() ran while the native client was being created.
        if (closed) {
          created.close(closed.message);
          throw new ClosingError(CLOSED_MESSAGE);
        }
        client = created;
        return created;
      },
      (error: unknown) => {
        creating = undefined;
        throw error;
      },
    );
    return creating;
  };

  const lazy = Object.create(GlideClient.prototype) as GlideClient;
  const define = (name: string, value: Method) =>
    Object.defineProperty(lazy, name, { value, writable: true, configurable: true });
  for (const name of methodNames) {
    define(name, (...args) => {
      if (client) return (client as unknown as Record<string, Method>)[name](...args);
      return connect().then((created) =>
        (created as unknown as Record<string, Method>)[name](...args),
      );
    });
  }
  define("close", (errorMessage?: unknown) => {
    if (closed) return;
    closed = { message: errorMessage as string | undefined };
    client?.close(closed.message);
  });
  // Glide's other public synchronous methods keep their synchronous results before creation.
  define("tryGetPubSubMessage", (decoder?: unknown) => {
    if (client)
      return client.tryGetPubSubMessage(
        decoder as Parameters<GlideClient["tryGetPubSubMessage"]>[0],
      );
    if (closed) throw new ClosingError(CLOSED_MESSAGE);
    // No native client means no push notifications have arrived yet.
    return null;
  });
  // Statistics are process-wide, and the pub/sub config helpers read only their argument.
  for (const name of ["getStatistics", "isPubsubConfigured", "getPubsubCallbackAndContext"]) {
    const method = (GlideClient.prototype as unknown as Record<string, Method>)[name];
    define(name, (...args) => method.apply(client ?? lazy, args));
  }
  connectors.set(lazy, connect);
  return lazy;
}

/** Creates the native client behind a lazy client now, rejecting if creation fails. */
export async function connectLazyValkeyClient(client: GlideClient): Promise<void> {
  await connectors.get(client)?.();
}
