-- Conditionally create a bloom filter only if the key does not already exist.
-- Unlike calling BF.RESERVE directly, this avoids a server-side "item exists"
-- error (which the Valkey Glide logger surfaces as a WARN even when caught in JS).
-- KEYS[1] = bloom filter key
-- ARGV[1] = error_rate (e.g. "0.01")
-- ARGV[2] = capacity (integer as string)
-- ARGV[3] = expansion rate (integer as string)
local key = KEYS[1]
if redis.call('EXISTS', key) == 1 then
  return 0
end
redis.call('BF.RESERVE', key, ARGV[1], ARGV[2], 'EXPANSION', ARGV[3])
return 1
