/**
 * Utilities for Valkey cache
 */

import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { ValkeyCacheMode } from "./types.mts";
import type { GlideString } from "@valkey/valkey-glide";

export class ValkeyCacheTypeError extends TypeError {
  constructor(message: string) {
    super(`ValkeyCache: ${message}`);
    this.name = "ValkeyCacheTypeError";
  }
}

export const durationInMilliseconds = (start: bigint): number =>
  Number(process.hrtime.bigint() - start) / 1_000_000;

const COMPRESSION_THRESHOLD = 2 * 1024; // 2kb
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Serialize a value for storage in Valkey cache
 * Supports text, buffer, and JSON modes with automatic compression
 */
export async function serializeValue(
  value: unknown,
  mode: ValkeyCacheMode,
): Promise<string | Buffer> {
  let serialized: string | Buffer;

  if (mode === "text") {
    if (typeof value !== "string") {
      throw new ValkeyCacheTypeError("text mode requires a string value");
    }
    serialized = value;
  } else if (mode === "buffer") {
    if (!Buffer.isBuffer(value)) {
      throw new ValkeyCacheTypeError("buffer mode requires a Buffer value");
    }
    serialized = value;
  } else {
    serialized = JSON.stringify(value);
  }

  if (Buffer.byteLength(serialized) > COMPRESSION_THRESHOLD) {
    serialized = await gzipAsync(serialized);
  }

  return serialized;
}

/**
 * Decode a value from Valkey cache
 * Handles decompression and parsing based on mode
 */
export async function decodeValue(
  result: GlideString | null,
  mode: ValkeyCacheMode,
): Promise<string | Buffer | Record<string, unknown> | null> {
  if (result === null) return null;
  if (!Buffer.isBuffer(result)) {
    throw new ValkeyCacheTypeError(`Expected Buffer, got ${typeof result}`);
  }
  let buffer: Buffer = result;

  // Check if buffer is gzipped by looking for gzip magic number (0x1f 0x8b)
  const isGzipped = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (isGzipped) {
    buffer = await gunzipAsync(buffer);
  }

  if (mode === "buffer") {
    return buffer;
  }

  const text = buffer.toString("utf8");

  if (mode === "text") {
    return text;
  }

  return JSON.parse(text);
}
