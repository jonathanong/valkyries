-- Get value with TTL operation (with optional bloom filter check)
-- This script is read-only and is executed using the read client
-- KEYS[1] = cache key (format: namespace:prefix:{serializedKey})
-- ARGV[1] = bloom filter key (optional, empty string if not provided)
-- Returns: {value, ttl_milliseconds, bloom_miss}
-- Where ttl_milliseconds is -2 if key doesn't exist, -1 if no expiry, or milliseconds remaining
-- bloom_miss is 1 if bloom filter says key definitely doesn't exist, 0 otherwise
if #KEYS == 0 then
  return {}
end

local cacheKey = KEYS[1]
local bloomFilterKey = ARGV[1]
-- Check bloom filter if provided and it exists
if bloomFilterKey ~= '' then
  local filterExists = redis.call('EXISTS', bloomFilterKey)
  if filterExists == 1 then
    -- Extract the entity key from inside {} (e.g., "cache:posts:{my-uuid}" -> "my-uuid")
    local entityKey = cacheKey:match('{(.+)}')
    if entityKey then
      local bloomExists = redis.call('BF.EXISTS', bloomFilterKey, entityKey)
      if bloomExists == 0 then
        -- Bloom filter says this key definitely doesn't exist
        return {false, -2, 1}
      end
    end
  end
end

local value = redis.call('GET', cacheKey)
if not value then
  return {false, -2, 0}
end
local ttl = redis.call('PTTL', cacheKey)
return {value, ttl, 0}
