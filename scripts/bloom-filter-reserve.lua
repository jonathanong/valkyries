-- Atomically unlink and re-create a bloom filter key.
-- Combining UNLINK + BF.RESERVE in a single Lua script prevents a race condition
-- where two concurrent callers both call UNLINK and then both call BF.RESERVE,
-- causing the second caller to receive an "item exists" error.
-- This script is write-only and must be executed using the write client.
-- KEYS[1] = bloom filter key
-- ARGV[1] = error_rate (e.g. "0.01")
-- ARGV[2] = capacity (integer as string)
-- ARGV[3] = expansion rate (integer as string)
redis.call('UNLINK', KEYS[1])
return redis.call('BF.RESERVE', KEYS[1], ARGV[1], ARGV[2], 'EXPANSION', ARGV[3])
