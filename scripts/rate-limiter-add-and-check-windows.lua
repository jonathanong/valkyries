-- Rate limiter multi-window add-and-check operation.
-- KEYS[1..N]: the sorted set keys
-- ARGV[1]: mode: "record-all" or "stop-on-limited"
-- ARGV[2..]: triples of ttl seconds, threshold, random member per key
-- Returns { count1, count2, ..., limitedFlag }
-- Uses server time to avoid client clock skew.

assert(ARGV[1] == 'record-all' or ARGV[1] == 'stop-on-limited', 'invalid mode')
assert((#ARGV - 1) == (#KEYS * 3), 'ARGV length mismatch: expected mode + 3 args per key')

local mode = ARGV[1]
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local response = {}
local limited = 0

for i, key in ipairs(KEYS) do
  if limited == 1 and mode == 'stop-on-limited' then
    table.insert(response, 0)
  else
    local argOffset = 2 + ((i - 1) * 3)
    local ttl = tonumber(ARGV[argOffset])
    local threshold = tonumber(ARGV[argOffset + 1])
    local randomElement = ARGV[argOffset + 2]
    local minScore = now - (ttl * 1000)

    redis.call('ZADD', key, now, randomElement)
    redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
    redis.call('EXPIRE', key, ttl)

    local count = redis.call('ZCOUNT', key, '(' .. minScore, now)
    table.insert(response, count)
    if count >= threshold then
      limited = 1
    end
  end
end

table.insert(response, limited)
return response
