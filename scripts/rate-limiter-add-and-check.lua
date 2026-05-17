-- Rate limiter add-and-check operation (atomic add + count in one roundtrip)
-- KEYS[1..N]: the sorted set keys
-- ARGV[1]: TTL in seconds
-- ARGV[2..N+1]: random element strings (one per key)
-- Returns array of counts after adding (same format as rate-limiter-get.lua)
-- Uses server time to avoid client clock skew

assert(#ARGV == #KEYS + 1, 'ARGV length mismatch: expected #KEYS + 1 (ttl + one random element per key)')

local ttl = tonumber(ARGV[1])
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local minScore = now - (ttl * 1000)

local response = {}
for i, key in ipairs(KEYS) do
  local randomElement = ARGV[1 + i]  -- ARGV[2] for KEYS[1], ARGV[3] for KEYS[2], etc.

  -- Add the current timestamp as the score
  redis.call('ZADD', key, now, randomElement)

  -- Remove all scores older than the TTL
  redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)

  -- Always expire the key after the TTL
  redis.call('EXPIRE', key, ttl)

  -- Count items in the current window (exclusive lower bound: ZREMRANGEBYSCORE already
  -- removed entries <= minScore, so use '(' to match only entries that survived cleanup)
  local count = redis.call('ZCOUNT', key, '(' .. minScore, now)
  table.insert(response, count)
end

return response
