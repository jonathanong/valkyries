-- Atomically reserve an idempotency key or report its existing state.
-- KEYS[1] = idempotency key
-- ARGV[1] = ttl seconds
-- ARGV[2] = processing value prefix
-- ARGV[3] = completed value
-- ARGV[4] = reservation token
-- Returns: reserved | processing prefix | completed value
local ttl = tonumber(ARGV[1])
local processingPrefix = ARGV[2]
local completedValue = ARGV[3]
local token = ARGV[4]
if ttl == nil or processingPrefix == nil or completedValue == nil or token == nil then
  error('idempotency-key-reserve: ttl, processing prefix, completed value, and token are required')
end

local existing = redis.call('GET', KEYS[1])
if existing then
  if existing == completedValue then
    return completedValue
  end
  if existing == processingPrefix .. ':' .. token then
    return 'reserved'
  end
  return processingPrefix
end

redis.call('SET', KEYS[1], processingPrefix .. ':' .. token, 'EX', ttl)
return 'reserved'
