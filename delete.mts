import { handleValkeyError } from "./errors.mts";
import type { GlideClient } from "@valkey/valkey-glide";

export const deleteKeysWithPrefix = async (client: GlideClient, pattern: string): Promise<void> => {
  let cursor = "0";
  const unlinkPromises: Promise<number>[] = [];

  try {
    do {
      // GlideClient scan method signature: scan(cursor: string, options?: ScanOptions)
      /* oxlint-disable no-await-in-loop */
      const result = await client.scan(cursor, { match: pattern });
      cursor = result[0] as string;
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
    } while (cursor !== "0");

    if (unlinkPromises.length > 0) {
      await Promise.all(unlinkPromises);
    }
  } catch (err) {
    handleValkeyError(err);
    throw err;
  }
};
