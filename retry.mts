import { randomInt } from "node:crypto";

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

const SATURATION_PATTERN = "Reached maximum inflight requests";

/**
 * Returns true when the error is a transient Valkey / Glide connection or saturation error
 * that is safe to retry (the operation was never sent or was rejected before execution).
 */
export function isRetryableValkeyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return RETRYABLE_PATTERNS.some((pattern) => msg.includes(pattern));
}

/**
 * Returns true only when the error is an inflight-saturation rejection
 * (`Reached maximum inflight requests`). Safe to retry because the command
 * was never sent — the client rejected it locally before any network I/O.
 */
export function isSaturationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(SATURATION_PATTERN);
}

export type RetryValkeyOperationOptions = {
  /** Maximum number of attempts (default: 3). */
  attempts?: number;
  /** Milliseconds to wait between attempts (default: 1000). */
  delayMs?: number;
  /** Predicate controlling which errors trigger a retry (default: isRetryableValkeyError). */
  shouldRetry?: (error: unknown) => boolean;
  /**
   * When true, each inter-attempt delay is randomized in [delayMs, delayMs * 5]
   * to spread out concurrent retriers during saturation. Defaults to false.
   */
  jitter?: boolean;
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
  const {
    attempts = 3,
    delayMs = 1000,
    shouldRetry = isRetryableValkeyError,
    jitter = false,
  } = options ?? {};
  const maxAttempts = Math.max(1, attempts);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!shouldRetry(error)) throw error;
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const maxJitter = Math.floor(delayMs * 4);
        const waitMs = jitter && maxJitter > 0 ? delayMs + randomInt(maxJitter + 1) : delayMs;
        // Unref the backoff timer: a pending retry is benign background work and must never
        // keep a process (or, notably, a test-runner worker) alive on its own. During normal
        // operation the process stays alive via other refed handles (e.g. the HTTP server); on
        // shutdown, an unrefed retry correctly stops blocking exit instead of forcing a timeout.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, waitMs);
          timer?.unref?.();
        });
      }
    }
  }
  throw lastError;
}

export type RetrySaturationErrorOptions = {
  /** Maximum number of attempts (default: 3). */
  attempts?: number;
  /**
   * Minimum milliseconds between attempts (default: 1000).
   * Actual delay is jittered in [delayMs, delayMs * 5] to spread concurrent retriers.
   */
  delayMs?: number;
};

/**
 * Retries a Valkey operation only on inflight-saturation rejections
 * (`Reached maximum inflight requests`), with jittered delay in [delayMs, delayMs*5].
 *
 * All other errors are rethrown immediately. Use this at internal command boundaries
 * so callers don't need to wrap each call site.
 *
 * @example
 * const value = await retrySaturationError(() => client.invokeScript(script, opts));
 */
export function retrySaturationError<T>(
  fn: () => Promise<T>,
  options?: RetrySaturationErrorOptions,
): Promise<T> {
  return retryValkeyOperation(fn, {
    attempts: options?.attempts,
    delayMs: options?.delayMs,
    shouldRetry: isSaturationError,
    jitter: true,
  });
}
