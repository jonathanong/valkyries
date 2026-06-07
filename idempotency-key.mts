import { randomUUID } from "node:crypto";
import { cacheValkeyClient } from "./clients.mts";
import { loadScript, registerScript } from "./scripts.mts";
import type { GlideClient } from "@valkey/valkey-glide";

const DEFAULT_PROCESSING_PREFIX = "processing";
const DEFAULT_COMPLETED_VALUE = "completed";
const RESERVED_RESULT = "reserved";
const MISSING_RESULT = "missing";
const CHANGED_RESULT = "changed";

const idempotencyKeyReserveScript = registerScript(
  loadScript("idempotency-key-reserve.lua", import.meta.url),
);
const idempotencyKeyCompleteIfCurrentScript = registerScript(
  loadScript("idempotency-key-complete-if-current.lua", import.meta.url),
);
const idempotencyKeyReleaseIfCurrentScript = registerScript(
  loadScript("idempotency-key-release-if-current.lua", import.meta.url),
);

export type GetAndDeleteOptions = {
  /** Optional Valkey client. Defaults to the package cache client. */
  client?: GlideClient;
};

export type IdempotencyKeyOptions = {
  /** Optional Valkey client. Defaults to the package cache client. */
  client?: GlideClient;
  /** Stored prefix for in-progress reservations. Defaults to "processing". */
  processingPrefix?: string;
  /** Stored value for completed reservations. Defaults to "completed". */
  completedValue?: string;
};

export type ReserveIdempotencyKeyOptions = IdempotencyKeyOptions & {
  /** Optional reservation token. Defaults to crypto.randomUUID(). */
  token?: string;
};

export type IdempotencyReservation =
  | { state: "reserved"; token: string }
  | { state: "processing" | "completed" };

export type IdempotencyCompletionResult = "completed" | "missing" | "changed";

export async function getAndDelete(
  key: string,
  options: GetAndDeleteOptions = {},
): Promise<string | null> {
  validateKey(key);
  const result = await (options.client ?? cacheValkeyClient).customCommand(["GETDEL", key]);
  if (result == null || result === false) return null;
  return stringifyValkeyResult(result);
}

export async function reserveIdempotencyKey(
  key: string,
  ttlSeconds: number,
  options: ReserveIdempotencyKeyOptions = {},
): Promise<IdempotencyReservation> {
  validateKey(key);
  validateTtlSeconds(ttlSeconds);
  const settings = normalizeIdempotencyOptions(options);
  const token = options.token ?? randomUUID();
  validateNonEmpty("token", token);

  const result = await settings.client.invokeScript(idempotencyKeyReserveScript, {
    keys: [key],
    args: [String(ttlSeconds), settings.processingPrefix, settings.completedValue, token],
  });

  if (result === RESERVED_RESULT) return { state: "reserved", token };
  if (result === settings.processingPrefix) return { state: "processing" };
  if (result === settings.completedValue) return { state: "completed" };
  throw new Error(`Unexpected idempotency reserve state: ${stringifyValkeyResult(result)}`);
}

export async function completeIdempotencyKey(
  key: string,
  token: string,
  ttlSeconds: number,
  options: IdempotencyKeyOptions = {},
): Promise<IdempotencyCompletionResult> {
  validateKey(key);
  validateNonEmpty("token", token);
  validateTtlSeconds(ttlSeconds);
  const settings = normalizeIdempotencyOptions(options);

  const result = await settings.client.invokeScript(idempotencyKeyCompleteIfCurrentScript, {
    keys: [key],
    args: [
      String(ttlSeconds),
      processingValue(settings.processingPrefix, token),
      settings.completedValue,
    ],
  });

  if (result === settings.completedValue) return "completed";
  if (result === MISSING_RESULT || result === CHANGED_RESULT) return result;
  throw new Error(`Unexpected idempotency completion state: ${stringifyValkeyResult(result)}`);
}

export async function releaseIdempotencyKey(
  key: string,
  token: string,
  options: IdempotencyKeyOptions = {},
): Promise<boolean> {
  validateKey(key);
  validateNonEmpty("token", token);
  const settings = normalizeIdempotencyOptions(options);

  const result = await settings.client.invokeScript(idempotencyKeyReleaseIfCurrentScript, {
    keys: [key],
    args: [processingValue(settings.processingPrefix, token)],
  });

  return result === 1 || result === 1n;
}

function normalizeIdempotencyOptions(
  options: IdempotencyKeyOptions,
): Required<IdempotencyKeyOptions> {
  const processingPrefix = options.processingPrefix ?? DEFAULT_PROCESSING_PREFIX;
  const completedValue = options.completedValue ?? DEFAULT_COMPLETED_VALUE;
  validateNonEmpty("processingPrefix", processingPrefix);
  validateNonEmpty("completedValue", completedValue);
  if (processingPrefix === completedValue) {
    throw new Error("processingPrefix must not equal completedValue");
  }
  return {
    client: options.client ?? cacheValkeyClient,
    processingPrefix,
    completedValue,
  };
}

function processingValue(processingPrefix: string, token: string): string {
  return `${processingPrefix}:${token}`;
}

function validateKey(key: string): void {
  validateNonEmpty("key", key);
}

function validateTtlSeconds(ttlSeconds: number): void {
  if (!(ttlSeconds > 0)) throw new Error("ttlSeconds must be greater than 0");
}

function validateNonEmpty(name: string, value: string): void {
  if (!value) throw new Error(`${name} must not be empty`);
}

function stringifyValkeyResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (typeof result === "number" || typeof result === "bigint" || typeof result === "boolean") {
    return result.toString();
  }
  return JSON.stringify(result) ?? "[unserializable]";
}
