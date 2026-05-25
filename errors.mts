export class ValkeyUrlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValkeyUrlError";
  }
}

export type ValkeyErrorHandler = (error: Error) => void;

/* v8 ignore next 4 -- default process-level fallback is replaced in tests and by applications. */
let valkeyErrorHandler: ValkeyErrorHandler = (error) => {
  if (process.env.NODE_ENV === "test") return;
  // oxlint-disable-next-line no-console -- default OSS error handler
  console.error(error);
};

export function setValkeyErrorHandler(handler: ValkeyErrorHandler): void {
  valkeyErrorHandler = handler;
}

export function handleValkeyError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  valkeyErrorHandler(normalized);
}

export class RateLimiterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimiterConfigurationError";
  }
}
