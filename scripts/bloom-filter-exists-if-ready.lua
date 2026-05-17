-- Check a ready marker, bloom filter existence, and one item in one roundtrip.
-- KEYS[1] = ready marker key
-- KEYS[2] = bloom filter key
-- ARGV[1] = item
-- Returns: 1 if item may exist, 0 if definitely not present, -1 if not ready/unavailable.
if redis.call('EXISTS', KEYS[1]) == 0 then
  return -1
end

if redis.call('EXISTS', KEYS[2]) == 0 then
  return -1
end

return redis.call('BF.EXISTS', KEYS[2], ARGV[1])
