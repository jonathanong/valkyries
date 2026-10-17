# Diagnostics

Read-only helpers for inspecting memory and keyspace usage. Choosing a client, checking deployment
topology, and naming groups are left to the caller.

## `parseValkeyMemoryInfo(info)`

```ts
parseValkeyMemoryInfo(info: string): ValkeyMemorySummary
```

Parses `INFO memory` text (`key:value` lines, `#` section headers, LF or CRLF). Throws when
`used_memory`, `used_memory_rss`, `used_memory_peak`, `maxmemory`, or `maxmemory_policy` is missing,
or when an integer field is not a non-negative safe integer. `usedMemoryDatasetBytes`,
`lazyfreePendingObjects`, and `memFragmentationRatio` are `null` when absent, but still throw when
present and malformed.

## `getValkeyMemoryInfo(client, options?)`

```ts
getValkeyMemoryInfo(
  client: Pick<GlideClient, "info">,
  options?: { signal?: AbortSignal },
): Promise<ValkeyMemorySummary>
```

Runs `INFO memory` and parses it. The signal is checked before and after the command.

## `countKeysByPrefix(client, prefixes, options?)`

```ts
import { countKeysByPrefix } from "valkyries";

const counts = await countKeysByPrefix(
  client,
  { cache: ["cache:"], sessions: ["session:", "sess:"] },
  { signal, count: 500 },
);
// { cache: 12, sessions: 3, unclassified: 40 }
```

Walks the keyspace with bounded `SCAN` pages (`count` defaults to 500) and checks `signal` before and
after each page, including the last. Keys matching no prefix are counted as `unclassified`. SCAN is
non-snapshot, so counts can include duplicates or miss keys written during the walk. The registry is
validated first.

## `validateKeyPrefixRegistry(prefixes)`

Throws for empty prefixes, a group named `unclassified`, and prefixes that overlap across groups
(identical, or one a prefix of another), so every key belongs to at most one group.
