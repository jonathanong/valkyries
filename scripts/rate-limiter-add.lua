-- Rate limiter add operation (handles multiple keys)
-- KEYS[1..N]: the sorted set keys
-- ARGV[1]: TTL in seconds
-- ARGV[2..N+1]: random element strings (one per key)
-- Uses server time to avoid client clock skew

local ttl = tonumber(ARGV[1])
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local minScore = now - (ttl * 1000)

for i, key in ipairs(KEYS) do
  local randomElement = ARGV[1 + i]  -- ARGV[2] for KEYS[1], ARGV[3] for KEYS[2], etc.
  
  -- Add the current timestamp as the score
  redis.call('ZADD', key, now, randomElement)
  
  -- Remove all scores older than the TTL (use -inf for clarity and correctness)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
  
  -- Always expire the key after the TTL
  redis.call('EXPIRE', key, ttl)
end

return 1

