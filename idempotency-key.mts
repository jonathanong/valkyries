import { randomUUID } from "node:crypto";
import { cacheValkeyClient } from "./clients.mts";
import { unlinkIfValueMatches } from "./conditional.mts";
import { loadScript, registerScript } from "./scripts.mts";
import { stringifyValkeyResult } from "./valkey-result.mts";
import { Decoder, type GlideClient } from "@valkey/valkey-glide";

const DEFAULT_PROCESSING_PREFIX = "processing";
const DEFAULT_COMPLETED_VALUE = "completed";
const RESERVED_RESULT = "reserved";
const MISSING_RESULT = "missing";
const CHANGED_RESULT = "changed";
const SCRIPT_RESULT_VALUES = new Set([RESERVED_RESULT, MISSING_RESULT, CHANGED_RESULT]);

const idempotencyKeyReserveScript = registerScript(
  loadScript("idempotency-key-reserve.lua", import.meta.url),
);
const idempotencyKeyCompleteIfCurrentScript = registerScript(
  loadScript("idempotency-key-complete-if-current.lua", import.meta.url),
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
  /** Opt in to atomically repair persistent existing reservations. */
  repairMissingExpiry?: {
    /** TTL for persistent completed values. Defaults to ttlSeconds. */
    completedTtlSeconds?: number;
  };
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
  const result = await (options.client ?? cacheValkeyClient).customCommand(["GETDEL", key], {
    decoder: Decoder.String,
  });
  if (result == null || result === false) return null;
  return stringifyValkeyResult(result);
}

export async function reserveIdempotencyKey(
  key: string,
  ttlSeconds: number,
  options: ReserveIdempotencyKeyOptions = {},
): Promise<IdempotencyReservation> {
  validateKey(key);
  validateTtlSeconds("ttlSeconds", ttlSeconds);
  const settings = normalizeIdempotencyOptions(options);
  const token = options.token ?? randomUUID();
  validateNonEmpty("token", token);
  const repairMissingExpiry = options.repairMissingExpiry !== undefined;
  const completedTtlSeconds = options.repairMissingExpiry?.completedTtlSeconds ?? ttlSeconds;
  validateTtlSeconds("completedTtlSeconds", completedTtlSeconds);

  const result = await settings.client.invokeScript(idempotencyKeyReserveScript, {
    keys: [key],
    args: [
      String(ttlSeconds),
      settings.processingPrefix,
      settings.completedValue,
      token,
      repairMissingExpiry ? "1" : "0",
      String(completedTtlSeconds),
    ],
    decoder: Decoder.String,
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
  validateTtlSeconds("ttlSeconds", ttlSeconds);
  const settings = normalizeIdempotencyOptions(options);

  const result = await settings.client.invokeScript(idempotencyKeyCompleteIfCurrentScript, {
    keys: [key],
    args: [
      String(ttlSeconds),
      processingValue(settings.processingPrefix, token),
      settings.completedValue,
    ],
    decoder: Decoder.String,
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

  return await unlinkIfValueMatches(key, processingValue(settings.processingPrefix, token), {
    client: settings.client,
  });
}

function normalizeIdempotencyOptions(
  options: IdempotencyKeyOptions,
): Required<IdempotencyKeyOptions> {
  const processingPrefix = options.processingPrefix ?? DEFAULT_PROCESSING_PREFIX;
  const completedValue = options.completedValue ?? DEFAULT_COMPLETED_VALUE;
  validateNonEmpty("processingPrefix", processingPrefix);
  validateNonEmpty("completedValue", completedValue);
  validateStoredStateValue("processingPrefix", processingPrefix);
  validateStoredStateValue("completedValue", completedValue);
  if (processingPrefix === completedValue) {
    throw new Error("processingPrefix must not equal completedValue");
  }
  if (completedValue.startsWith(`${processingPrefix}:`)) {
    throw new Error("completedValue must not be in the processing namespace");
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

function validateTtlSeconds(name: string, ttlSeconds: number): void {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function validateNonEmpty(name: string, value: string): void {
  if (!value) throw new Error(`${name} must not be empty`);
}

function validateStoredStateValue(name: string, value: string): void {
  if (SCRIPT_RESULT_VALUES.has(value)) {
    throw new Error(`${name} must not equal a script result sentinel`);
  }
}
