-- Atomically delete cache keys and record short-lived invalidation timestamps.
-- KEYS[1..n] = cache keys
-- KEYS[n+1..2n] = invalidation marker keys matching each cache key
-- ARGV[1] = number of cache keys
-- ARGV[2] = invalidation marker TTL in seconds
if #KEYS == 0 then
  return 0
end

local keyCount = tonumber(ARGV[1])
local invalidationTtl = tonumber(ARGV[2])
if keyCount == nil or invalidationTtl == nil then
  error('cache-delete-with-invalidation: key count and invalidation TTL are required')
end
if keyCount == 0 then
  return 0
end
if #KEYS ~= keyCount * 2 then
  error('cache-delete-with-invalidation: expected cache keys followed by invalidation keys')
end

local cacheKeys = {}
for i = 1, keyCount do
  cacheKeys[i] = KEYS[i]
  local invalidationKey = KEYS[keyCount + i]
  redis.call('SET', invalidationKey, '1', 'EX', invalidationTtl)
end

return redis.call('UNLINK', unpack(cacheKeys))
