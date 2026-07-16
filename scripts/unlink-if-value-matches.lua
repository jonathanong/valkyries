-- Atomically unlink a key only when its stored value matches the expected value.
-- KEYS[1] = key
-- ARGV[1] = expected value
-- Returns: 1 when unlinked, 0 when absent or changed.
if ARGV[1] == nil then
  error('unlink-if-value-matches: expected value is required')
end

local existing = redis.call('GET', KEYS[1])
if existing and existing == ARGV[1] then
  redis.call('UNLINK', KEYS[1])
  return 1
end
return 0
