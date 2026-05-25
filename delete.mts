import { handleValkeyError } from "./errors.mts";
import type { GlideClient } from "@valkey/valkey-glide";

const UNLINK_BATCH_SIZE = 100;
type UnlinkResult = { success: true; deletedCount: number } | { success: false; error: unknown };

export const deleteKeysWithPrefix = async (client: GlideClient, pattern: string): Promise<void> => {
  let cursor = "0";
  const unlinkPromises: Promise<UnlinkResult>[] = [];
  let primaryError: unknown = null;
  const unlinkErrors: unknown[] = [];

  const flushUnlinkPromises = async () => {
    if (unlinkPromises.length === 0) {
      return;
    }

    const results = await Promise.all(unlinkPromises);
    unlinkPromises.length = 0;

    for (const result of results) {
      if (!result.success) {
        unlinkErrors.push(result.error);
        if (primaryError === null) {
          primaryError = result.error;
        }
      }
    }
  };

  try {
    do {
      // GlideClient scan method signature: scan(cursor: string, options?: ScanOptions)
      /* oxlint-disable no-await-in-loop */
      const result = await client.scan(cursor, { match: pattern });
      cursor = result[0] as string;
      const keys = result[1] as string[];

      if (keys.length > 0) {
        unlinkPromises.push(
          client
            .unlink(keys)
            .then((deletedCount) => ({ success: true, deletedCount }) satisfies UnlinkResult)
            .catch((error) => ({ success: false, error }) satisfies UnlinkResult),
        );

        // Prevent unbounded memory/concurrency by batching promises.
        if (unlinkPromises.length >= UNLINK_BATCH_SIZE) {
          await flushUnlinkPromises();
          if (primaryError !== null) {
            throw primaryError;
          }
        }
      }
    } while (cursor !== "0");

    if (unlinkPromises.length > 0) {
      await flushUnlinkPromises();
    }
  } catch (err) {
    if (primaryError === null) {
      primaryError = err;
    }
    await flushUnlinkPromises();
  }

  if (primaryError !== null) {
    const uniqueErrors = new Set(unlinkErrors);
    for (const error of uniqueErrors) {
      handleValkeyError(error);
    }

    if (!uniqueErrors.has(primaryError)) {
      handleValkeyError(primaryError);
    }
    throw primaryError;
  }
};
