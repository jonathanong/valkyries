-- Add items to the live bloom filter and, if an active rebuild is running,
-- also to the building key. No-op if neither key exists (post-#1955) so a
-- missing filter stays missing and cache reads fall back to the DB rather
-- than to an empty / under-provisioned auto-created filter.
-- This script is write-only and must be executed using the write client.
-- KEYS[1] = live key
-- KEYS[2] = building key
-- ARGV[1..n] = items to add
-- Returns: 1 if any write occurred, 0 otherwise.
if #ARGV == 0 then
  return 0
end

local wrote = 0

if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('BF.MADD', KEYS[1], unpack(ARGV))
  wrote = 1
end

if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('BF.MADD', KEYS[2], unpack(ARGV))
  wrote = 1
end

return wrote
