-- Conditionally set cache values unless a newer invalidation marker exists.
-- KEYS[1..n] = cache keys
-- KEYS[n+1..2n] = invalidation marker keys matching each cache key
-- ARGV[1] = number of cache keys
-- Repeated per key:
--   ttl seconds
--   serialized value
-- Returns one result per key: 1 when set, 0 when skipped.
if #KEYS == 0 then
  return {}
end

local keyCount = tonumber(ARGV[1])
if keyCount == nil then
  error('cache-set-if-not-invalidated: key count is required')
end
if keyCount == 0 then
  return {}
end
if #KEYS ~= keyCount * 2 then
  error('cache-set-if-not-invalidated: expected cache keys followed by invalidation keys')
end
if #ARGV ~= 1 + (keyCount * 2) then
  error('cache-set-if-not-invalidated: expected ttl and value for each key')
end

local results = {}
for i = 1, keyCount do
  local cacheKey = KEYS[i]
  local invalidationKey = KEYS[keyCount + i]
  local argOffset = 1 + ((i - 1) * 2)
  local ttl = tonumber(ARGV[argOffset + 1])
  local value = ARGV[argOffset + 2]

  if ttl == nil then
    error('cache-set-if-not-invalidated: ttl must be a number')
  end

  if redis.call('EXISTS', invalidationKey) == 1 then
    table.insert(results, 0)
  else
    redis.call('SET', cacheKey, value, 'EX', ttl)
    table.insert(results, 1)
  end
end

return results
