import { handleValkeyError } from "./errors.mts";
import type { GlideClient } from "@valkey/valkey-glide";

export const deleteKeysWithPrefix = async (client: GlideClient, pattern: string): Promise<void> => {
  const unlinkPromises: Promise<number>[] = [];

  const scanRecursive = async (cursor: string): Promise<void> => {
    // GlideClient scan method signature: scan(cursor: string, options?: ScanOptions)
    const result = await client.scan(cursor, { match: pattern });
    const nextCursor = result[0] as string;
    const keys = result[1] as string[];

    if (keys.length > 0) {
      // Attach a no-op catch to prevent unhandled rejection crashes if scan fails
      // before Promise.all is reached. SonarCloud complains about empty callbacks,
      // so we call a dummy function or use a minimal expression.
      const p = client.unlink(keys);
      p.catch(() => undefined);
      unlinkPromises.push(p);

      // Prevent unbounded memory/concurrency by batching promises
      if (unlinkPromises.length >= 100) {
        await Promise.all(unlinkPromises);
        unlinkPromises.length = 0;
      }
    }

    if (nextCursor !== "0") {
      await scanRecursive(nextCursor);
    }
  };

  try {
    await scanRecursive("0");

    if (unlinkPromises.length > 0) {
      await Promise.all(unlinkPromises);
    }
  } catch (err) {
    handleValkeyError(err);
    throw err;
  }
};
