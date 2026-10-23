-- Rate limiter all-or-nothing weighted consume (atomic check + add in one roundtrip)
-- KEYS[1..N]: the sorted set keys
-- ARGV[1]: TTL in seconds
-- ARGV[2]: threshold (a key is refused when count + cost >= threshold)
-- ARGV[3]: cost (number of members to add per key)
-- ARGV[4]: random base string; members are base-keyIndex-unitIndex
-- Returns { limited (0/1), retryAfterMs, count1, ..., countN }
--   limited: counts are pre-call counts and nothing is added to any key
--   not limited: counts are post-add counts
-- Uses server time to avoid client clock skew

assert(#ARGV == 4, 'ARGV length mismatch: expected ttl, threshold, cost, base')

local ttl = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local base = ARGV[4]
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local ttlMs = ttl * 1000
local minScore = now - ttlMs

-- Keep each ZADD well under Lua's unpack/C-stack limit
local ZADD_CHUNK = 500

local counts = {}
local limited = false
local retryAfterMs = 0
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
  -- Exclusive lower bound matches rate-limiter-add-and-check.lua
  local count = redis.call('ZCOUNT', key, '(' .. minScore, now)
  counts[i] = count
  if count + cost >= threshold then
    limited = true
    local wait = ttlMs
    if cost < threshold then
      -- The (count + cost - threshold + 1)-th oldest entry must expire before this fits
      local need = count + cost - threshold + 1
      local entry = redis.call('ZRANGE', key, need - 1, need - 1, 'WITHSCORES')
      wait = math.ceil(tonumber(entry[2]) + ttlMs - now)
    end
    if wait > retryAfterMs then
      retryAfterMs = wait
    end
  end
end

if limited then
  local response = { 1, retryAfterMs }
  for i = 1, #counts do
    response[i + 2] = counts[i]
  end
  return response
end

local response = { 0, 0 }
for i, key in ipairs(KEYS) do
  local unit = 1
  while unit <= cost do
    local last = math.min(unit + ZADD_CHUNK - 1, cost)
    local zaddArgs = {}
    for u = unit, last do
      zaddArgs[#zaddArgs + 1] = now
      zaddArgs[#zaddArgs + 1] = base .. '-' .. i .. '-' .. u
    end
    redis.call('ZADD', key, unpack(zaddArgs))
    unit = last + 1
  end
  redis.call('EXPIRE', key, ttl)
  response[i + 2] = counts[i] + cost
end

return response
