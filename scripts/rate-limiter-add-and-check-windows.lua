-- Rate limiter multi-window add-and-check operation.
-- KEYS[1..N]: the sorted set keys
-- ARGV[1]: mode: "record-all" or "stop-on-limited"
-- ARGV[2..]: quads of ttl seconds, threshold, skip-write-when-limited flag, random member per key
-- Returns { count1, count2, ..., limitedFlag, wrote1, wrote2, ... }
-- Uses server time to avoid client clock skew.

assert(ARGV[1] == 'record-all' or ARGV[1] == 'stop-on-limited', 'invalid mode')
assert((#ARGV - 1) == (#KEYS * 4), 'ARGV length mismatch: expected mode + 4 args per key')

local mode = ARGV[1]
local currentTime = redis.call('TIME')
local now = tonumber(currentTime[1]) * 1000 + tonumber(currentTime[2]) / 1000
local response = {}
local wrote = {}
local limited = 0

for i, key in ipairs(KEYS) do
  if limited == 1 and mode == 'stop-on-limited' then
    table.insert(response, 0)
    table.insert(wrote, 0)
  else
    local argOffset = 2 + ((i - 1) * 4)
    local ttl = tonumber(ARGV[argOffset])
    local threshold = tonumber(ARGV[argOffset + 1])
    local skipWriteWhenLimited = ARGV[argOffset + 2] == '1'
    local randomElement = ARGV[argOffset + 3]
    local minScore = now - (ttl * 1000)
    local count

    redis.call('ZREMRANGEBYSCORE', key, '-inf', minScore)
    if skipWriteWhenLimited then
      count = redis.call('ZCOUNT', key, '(' .. minScore, now)
    end

    if skipWriteWhenLimited and count >= threshold then
      table.insert(wrote, 0)
    else
      redis.call('ZADD', key, now, randomElement)
      redis.call('EXPIRE', key, ttl)
      if skipWriteWhenLimited then
        count = count + 1
      else
        count = redis.call('ZCOUNT', key, '(' .. minScore, now)
      end
      table.insert(wrote, 1)
    end

    table.insert(response, count)
    if count >= threshold then
      limited = 1
    end
  end
end

table.insert(response, limited)
for _, writeFlag in ipairs(wrote) do
  table.insert(response, writeFlag)
end
return response
