-- Rate limiter get operation (handles multiple keys)
-- NOTE: intentionally executed via rateLimiterValkeyClient (primary-only) to avoid
-- replica lag causing stale counts that could allow rate limit bypasses.
-- KEYS[1..N]: the sorted set keys
-- ARGV[1]: TTL in seconds
-- Uses server time to avoid client clock skew

local ttl = tonumber(ARGV[1])
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local minScore = now - (ttl * 1000)
local maxScore = now

local response = {}
for _, key in ipairs(KEYS) do
  -- Use exclusive lower bound to match add-and-check.lua behavior at boundary
  local count = redis.call('ZCOUNT', key, '(' .. minScore, maxScore)
  table.insert(response, count)
end

return response

