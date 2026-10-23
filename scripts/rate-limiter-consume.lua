-- Rate limiter all-or-nothing weighted consume (atomic check + add in one roundtrip)
-- KEYS[1..N]: the sorted set keys (a key repeated K times is charged K * cost)
-- ARGV[1]: TTL in seconds
-- ARGV[2]: threshold (a key is refused when count + charge >= threshold)
-- ARGV[3]: cost (number of members to add per KEYS entry)
-- ARGV[4]: random base string; members are base-keyIndex-unitIndex
-- Returns { limited (0/1), retryAfterMs, count1, ..., countN }
--   limited: counts are pre-call counts and nothing is added to any key
--   not limited: counts are post-add counts
-- Uses server time to avoid client clock skew

assert(#ARGV == 4, 'ARGV length mismatch: expected ttl, threshold, cost, base')

local ttl = tonumber(ARGV[1])
-- Counts are integers, so count >= threshold is the same as count >= ceil(threshold)
local threshold = math.ceil(tonumber(ARGV[2]))
local cost = tonumber(ARGV[3])
local base = ARGV[4]
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local ttlMs = ttl * 1000
local minScore = now - ttlMs

-- Keep each ZADD well under Lua's unpack/C-stack limit
local ZADD_CHUNK = 500

-- Trim and count each unique key once; duplicates add to that key's charge
local countByKey = {}
local chargeByKey = {}
local uniqueKeys = {}
for _, key in ipairs(KEYS) do
  if countByKey[key] == nil then
    redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
    -- Exclusive lower bound matches rate-limiter-add-and-check.lua
    countByKey[key] = redis.call('ZCOUNT', key, '(' .. minScore, now)
    chargeByKey[key] = 0
    uniqueKeys[#uniqueKeys + 1] = key
  end
  chargeByKey[key] = chargeByKey[key] + cost
end

local limited = false
local retryAfterMs = 0
for _, key in ipairs(uniqueKeys) do
  local count = countByKey[key]
  local charge = chargeByKey[key]
  if count + charge >= threshold then
    limited = true
    local wait = ttlMs
    if charge < threshold then
      -- The (count + charge - threshold + 1)-th oldest entry must expire before this fits
      local need = count + charge - threshold + 1
      local entry = redis.call('ZRANGE', key, need - 1, need - 1, 'WITHSCORES')
      wait = math.ceil(tonumber(entry[2]) + ttlMs - now)
    end
    if wait > retryAfterMs then
      retryAfterMs = wait
    end
  end
end

local response = { 0, 0 }
if limited then
  response[1] = 1
  response[2] = retryAfterMs
  for i, key in ipairs(KEYS) do
    response[i + 2] = countByKey[key]
  end
  return response
end

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
  response[i + 2] = countByKey[key] + chargeByKey[key]
end

return response
