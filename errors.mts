export type ValkeyErrorHandler = (error: Error) => void;

/* v8 ignore next 4 -- default process-level fallback is replaced in tests and by applications. */
let valkeyErrorHandler: ValkeyErrorHandler = (error) => {
  if (process.env.NODE_ENV === "test") return;
  console.error(error);
};

export function setValkeyErrorHandler(handler: ValkeyErrorHandler): void {
  valkeyErrorHandler = handler;
}

export function handleValkeyError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  valkeyErrorHandler(normalized);
}
