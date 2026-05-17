import { handleValkeyError } from "./errors.mts";
import type { GlideClient } from "@valkey/valkey-glide";

export const deleteKeysWithPrefix = async (client: GlideClient, pattern: string): Promise<void> => {
  const deletionPromises: Promise<number | void>[] = [];
  let cursor = "0";

  do {
    try {
      // GlideClient scan method signature: scan(cursor: string, options?: ScanOptions)
      /* oxlint-disable no-await-in-loop */
      const result = await client.scan(cursor, { match: pattern });
      cursor = result[0] as string;
      const keys = result[1] as string[];

      if (keys.length > 0) {
        deletionPromises.push(client.unlink(keys).catch(handleValkeyError));
      }
    } catch (err) {
      handleValkeyError(err as Error);
      throw err;
    }
  } while (cursor !== "0");

  await Promise.all(deletionPromises);
};
