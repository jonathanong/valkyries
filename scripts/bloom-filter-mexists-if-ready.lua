-- Check a ready marker, bloom filter existence, and multiple items in one roundtrip.
-- KEYS[1] = ready marker key
-- KEYS[2] = bloom filter key
-- ARGV[1..n] = items
-- Returns: array where 1=may exist, 0=definitely not present, -1=not ready/unavailable.
local result = {}

if #ARGV == 0 then
  return result
end

if redis.call('EXISTS', KEYS[1]) == 0 or redis.call('EXISTS', KEYS[2]) == 0 then
  for i = 1, #ARGV do
    result[i] = -1
  end
  return result
end

return redis.call('BF.MEXISTS', KEYS[2], unpack(ARGV))
