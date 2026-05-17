-- Dynamic config set-fields operation (HSET + PUBLISH all in one roundtrip)
-- KEYS[1]: hash key
-- ARGV[1,3,5,...]: field names
-- ARGV[2,4,6,...]: field values
-- Sets all fields in the hash and publishes per-field update events

-- Guard: HSET with no fields is a Valkey error
if #ARGV == 0 then return 0 end
-- Guard: ARGV must contain field/value pairs (even length)
assert(#ARGV % 2 == 0, 'ARGV must contain field/value pairs (even length)')

-- HSET all fields at once
redis.call('HSET', KEYS[1], unpack(ARGV))

-- PUBLISH per field so subscribers get real-time updates
local numArgs = #ARGV
for i = 1, numArgs, 2 do
  local field = ARGV[i]
  local value = ARGV[i + 1]
  redis.call('PUBLISH', KEYS[1] .. ':' .. field, value)
end

return 1
