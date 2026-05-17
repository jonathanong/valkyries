-- Check bloom filter existence in a single roundtrip
-- Read-only: execute with cacheValkeyClient
-- KEYS[1]: filter key
-- ARGV[1]: item to check
-- Returns: 1 if item may exist, 0 if definitely not present, -1 if filter doesn't exist

local key = KEYS[1]
local item = ARGV[1]

if redis.call('EXISTS', key) == 0 then
  return -1
end

return redis.call('BF.EXISTS', key, item)
