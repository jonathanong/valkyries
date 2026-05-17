-- Check multiple items in bloom filter in a single roundtrip
-- Read-only: execute with cacheValkeyClient
-- KEYS[1]: filter key
-- ARGV[1..n]: items to check
-- Returns: array where 1=may exist, 0=definitely not present, -1=filter doesn't exist

local key = KEYS[1]

if redis.call('EXISTS', key) == 0 then
  local result = {}
  for i = 1, #ARGV do
    result[i] = -1
  end
  return result
end

return redis.call('BF.MEXISTS', key, unpack(ARGV))
