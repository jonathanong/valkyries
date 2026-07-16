-- Atomically reserve an idempotency key or report its existing state.
-- KEYS[1] = idempotency key
-- ARGV[1] = ttl seconds
-- ARGV[2] = processing value prefix
-- ARGV[3] = completed value
-- ARGV[4] = reservation token
-- ARGV[5] = repair missing expiry (1 or 0)
-- ARGV[6] = completed ttl seconds
-- Returns: reserved | processing prefix | completed value
local ttl = tonumber(ARGV[1])
local processingPrefix = ARGV[2]
local completedValue = ARGV[3]
local token = ARGV[4]
local repairMissingExpiry = ARGV[5]
local completedTtl = tonumber(ARGV[6])
if ttl == nil or processingPrefix == nil or completedValue == nil or token == nil or repairMissingExpiry == nil or completedTtl == nil then
  error('idempotency-key-reserve: ttl, processing prefix, completed value, token, repair flag, and completed ttl are required')
end
if ttl <= 0 or completedTtl <= 0 then
  error('idempotency-key-reserve: ttl and completed ttl must be positive')
end
if repairMissingExpiry ~= '0' and repairMissingExpiry ~= '1' then
  error('idempotency-key-reserve: repair flag must be 0 or 1')
end

local existing = redis.call('GET', KEYS[1])
if existing then
  if repairMissingExpiry == '1' then
    if existing == completedValue then
      redis.call('EXPIRE', KEYS[1], completedTtl, 'NX')
    else
      redis.call('EXPIRE', KEYS[1], ttl, 'NX')
    end
  end
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
