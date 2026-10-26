-- Atomically set a millisecond TTL on a key only when its stored value matches the expected value.
-- KEYS[1] = key
-- ARGV[1] = expected value
-- ARGV[2] = TTL in milliseconds
-- Returns: 1 when the TTL was set, 0 when absent or changed.
if ARGV[1] == nil then
  error('pexpire-if-value-matches: expected value is required')
end
if ARGV[2] == nil then
  error('pexpire-if-value-matches: ttl is required')
end

local existing = redis.call('GET', KEYS[1])
if existing and existing == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
