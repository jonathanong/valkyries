-- Complete an idempotency reservation only if the caller still owns the token.
-- KEYS[1] = idempotency key
-- ARGV[1] = ttl seconds
-- ARGV[2] = expected processing value
-- ARGV[3] = completed value
-- Returns: completed value | missing | changed
local ttl = tonumber(ARGV[1])
local expectedProcessingValue = ARGV[2]
local completedValue = ARGV[3]
if ttl == nil or expectedProcessingValue == nil or completedValue == nil then
  error('idempotency-key-complete-if-current: ttl, expected processing value, and completed value are required')
end

local existing = redis.call('GET', KEYS[1])
if not existing then
  return 'missing'
end
if existing ~= expectedProcessingValue then
  return 'changed'
end

redis.call('SET', KEYS[1], completedValue, 'EX', ttl)
return completedValue
