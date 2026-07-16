-- Compatibility script for callers that load the historical idempotency-specific filename.
-- New code should use unlink-if-value-matches.lua through unlinkIfValueMatches().
-- KEYS[1] = idempotency key
-- ARGV[1] = expected processing value
-- Returns: 1 when released, 0 when absent or changed.
local existing = redis.call('GET', KEYS[1])
if existing and existing == ARGV[1] then
  redis.call('UNLINK', KEYS[1])
  return 1
end
return 0
