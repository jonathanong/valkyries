import { handleValkeyError } from "./errors.mts";
import type { GlideClient } from "@valkey/valkey-glide";

const UNLINK_BATCH_SIZE = 100;
type UnlinkResult = { success: true; deletedCount: number } | { success: false; error: unknown };
type DeleteState = {
  unlinkPromises: Promise<UnlinkResult>[];
  primaryError: unknown;
  unlinkErrors: unknown[];
};

const createDeleteState = (): DeleteState => ({
  unlinkPromises: [],
  primaryError: null,
  unlinkErrors: [],
});

const enqueueUnlink = (client: GlideClient, keys: string[], state: DeleteState) => {
  if (keys.length === 0) {
    return;
  }

  const unlinkResult = client
    .unlink(keys)
    .then((deletedCount) => ({ success: true, deletedCount }) as UnlinkResult)
    .catch((error) => ({ success: false, error }) as UnlinkResult);

  state.unlinkPromises.push(unlinkResult);
};

const flushUnlinkPromises = async (state: DeleteState) => {
  if (state.unlinkPromises.length === 0) {
    return;
  }

  const pendingPromises = state.unlinkPromises.splice(0);
  const results = await Promise.all(pendingPromises);

  for (const result of results) {
    if (!result.success) {
      state.unlinkErrors.push(result.error);
      if (state.primaryError === null) {
        state.primaryError = result.error;
      }
    }
  }
};

const maybeFlushUnlinkPromises = async (state: DeleteState) => {
  if (state.unlinkPromises.length < UNLINK_BATCH_SIZE) {
    return;
  }

  await flushUnlinkPromises(state);
};

const scanAndCollectUnlinks = async (client: GlideClient, pattern: string, state: DeleteState) => {
  let cursor = "0";

  while (true) {
    const [cursorFromServer, keys] = await client.scan(cursor, { match: pattern });
    cursor = cursorFromServer as string;
    enqueueUnlink(client, keys as string[], state);
    await maybeFlushUnlinkPromises(state);

    if (state.primaryError !== null) {
      throw state.primaryError;
    }

    if (cursor === "0") {
      break;
    }
  }
};

const reportAndThrowIfNeeded = (state: DeleteState) => {
  if (state.primaryError === null) {
    return;
  }

  const handledErrors = new Set(state.unlinkErrors);
  for (const error of handledErrors) {
    handleValkeyError(error);
  }

  if (!handledErrors.has(state.primaryError)) {
    handleValkeyError(state.primaryError);
  }

  throw state.primaryError;
};

export const deleteKeysWithPrefix = async (client: GlideClient, pattern: string): Promise<void> => {
  const state = createDeleteState();

  try {
    await scanAndCollectUnlinks(client, pattern, state);
    await flushUnlinkPromises(state);
  } catch (err) {
    if (state.primaryError === null) {
      state.primaryError = err;
    }
    await flushUnlinkPromises(state);
  } finally {
    await flushUnlinkPromises(state);
  }

  reportAndThrowIfNeeded(state);
};
