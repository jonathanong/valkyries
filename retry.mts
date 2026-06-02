/**
 * Substring patterns that identify transient Valkey / Glide errors which are safe to retry.
 * These originate from the @valkey/valkey-glide native Rust core.
 */
const RETRYABLE_PATTERNS = [
  "Reached maximum inflight requests",
  "Connection closed",
  "Request timed out",
  "Socket was closed",
  "Client is in closing state",
];

/**
 * Returns true when the error is a transient Valkey / Glide connection or saturation error
 * that is safe to retry (the operation was never sent or was rejected before execution).
 */
export function isRetryableValkeyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return RETRYABLE_PATTERNS.some((pattern) => msg.includes(pattern));
}

export type RetryValkeyOperationOptions = {
  /** Maximum number of attempts (default: 3). */
  attempts?: number;
  /** Milliseconds to wait between attempts (default: 1000). */
  delayMs?: number;
  /** Predicate controlling which errors trigger a retry (default: isRetryableValkeyError). */
  shouldRetry?: (error: unknown) => boolean;
};

/**
 * Retries a Valkey operation on transient connection / saturation errors.
 *
 * Non-retryable errors (shouldRetry returns false) are rethrown immediately.
 * After all attempts are exhausted the last error is rethrown.
 *
 * @example
 * const job = await retryValkeyOperation(() => queue.add(name, data, opts));
 */
export async function retryValkeyOperation<T>(
  fn: () => Promise<T>,
  options?: RetryValkeyOperationOptions,
): Promise<T> {
  const { attempts = 3, delayMs = 1000, shouldRetry = isRetryableValkeyError } = options ?? {};
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!shouldRetry(error)) throw error;
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
