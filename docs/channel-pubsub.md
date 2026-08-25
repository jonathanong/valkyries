# Channel Pub/Sub

`createChannelPubSub()` creates a dedicated publisher and pattern subscriber for messages scoped by
an application-defined prefix and key. It is an ephemeral delivery primitive: messages are not
persisted, and subscribers do not receive messages published before their Valkey subscription is
active.

## Import

```ts
import { createChannelPubSub, type ChannelSubscription } from "valkyries/channel-pubsub";
```

This subpath is intentionally not exported from `valkyries`; importing it never initializes a
package-managed client.

## Create a channel

```ts
const events = createChannelPubSub<{ state: string }>("exports", {
  clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
  onError: (error) => logger.error(error),
});
```

`clientConfig` is passed to `GlideClient.createClient()`. Supply `createClient` to own connection
creation, for example when an application injects clients in tests. `serialize` and `deserialize`
default to JSON. `onError` receives codec, handler, and subscriber-shutdown failures; publish and
initial subscriber-connection failures reject their calling promise.

`clientConfig` must not include `pubsubSubscriptions`; this API owns the subscriber's pattern and
callback. `onError` failures are contained so consumer and cleanup isolation is preserved.

Prefixes and keys must be non-empty and cannot contain Valkey glob characters (`?`, `*`, `[`, `]`,
or `\`). This prevents a prefix from widening the subscriber pattern unintentionally.

`closeSubscriberWhenIdle` closes the subscriber when the final subscription closes. Set
`subscriberCloseTimeoutMs` to a positive safe integer to bound its `PUNSUBSCRIBE` request; it
defaults to `5000`.

## Use and close

```ts
const subscription: ChannelSubscription<{ state: string }> = await events.subscribe(exportId);
subscription.setHandler((event) => send(event));
await events.publish(exportId, { state: "ready" });
await subscription.close();
await events.close();
```

Subscriptions buffer messages received before a handler is installed and replay them when it is.
Multiple subscriptions for one key each receive the message. Calling `setHandler()` replaces the
previous handler. Both subscription `close()` and owner `close()` are idempotent. Owner `close()`
also closes the lazy publisher; future `publish()` and `subscribe()` calls reject.

`closeSubscriber()` closes only an idle subscriber connection. It rejects while subscriptions are
active, preventing live handles from silently losing delivery. `close()` is the explicit owner
shutdown operation and closes active subscriptions' connection safely; it coalesces concurrent
callers until cleanup completes.
