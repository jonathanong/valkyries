-- Get values with TTL operation (handles multiple keys with optional bloom filter check)
-- This script is read-only and is executed using the read client
-- KEYS[1..n] = cache keys (format: namespace:prefix:{serializedKey})
-- ARGV[1] = bloom filter key (optional, empty string if not provided)
-- Returns: {value1, ttl1, bloom_miss1, value2, ttl2, bloom_miss2, ...}
-- Where ttl is in milliseconds (-2 if key doesn't exist, -1 if no expiry)
-- bloom_miss is 1 if bloom filter says key definitely doesn't exist, 0 otherwise
if #KEYS == 0 then
  return {}
end

local bloomFilterKey = ARGV[1]
-- Step 1: Check bloom filter before MGET to avoid fetching known-missing keys.
-- bloomResults[i] == 0: not in filter = bloom miss
-- bloomResults[i] == nil: no entity key extracted, skip check = not a bloom miss
-- bloomResults[i] == 1: in filter = not a bloom miss
local bloomResults = {}
if bloomFilterKey ~= '' then
  local filterExists = redis.call('EXISTS', bloomFilterKey)
  if filterExists == 1 then
    local entityKeys = {}
    local entityKeyIndices = {}
    for i, key in ipairs(KEYS) do
      local entityKey = key:match('{(.+)}')
      if entityKey then
        table.insert(entityKeys, entityKey)
        table.insert(entityKeyIndices, i)
      end
    end
    if #entityKeys > 0 then
      local mexistsResults = redis.call('BF.MEXISTS', bloomFilterKey, unpack(entityKeys))
      for j, result in ipairs(mexistsResults) do
        bloomResults[entityKeyIndices[j]] = result
      end
    end
  end
end

-- Step 2: Collect non-bloom-miss keys to fetch.
local fetchIndices = {}
local fetchKeys = {}
for i, key in ipairs(KEYS) do
  if bloomResults[i] ~= 0 then
    table.insert(fetchIndices, i)
    table.insert(fetchKeys, key)
  end
end

-- Step 3: MGET only the non-bloom-miss keys.
local fetched = {}
if #fetchKeys > 0 then
  fetched = redis.call('MGET', unpack(fetchKeys))
end

-- Map fetched values back to original indices.
local valuesByIndex = {}
for j, idx in ipairs(fetchIndices) do
  valuesByIndex[idx] = fetched[j]
end

-- Step 4: Build response.
local response = {}
for i, key in ipairs(KEYS) do
  if bloomResults[i] == 0 then
    -- Bloom miss: key definitely doesn't exist, no MGET or PTTL needed
    table.insert(response, false)
    table.insert(response, -2)
    table.insert(response, 1)
  else
    local value = valuesByIndex[i]
    local ttl = -2
    if value then
      ttl = redis.call('PTTL', key)
    end
    table.insert(response, value)
    table.insert(response, ttl)
    table.insert(response, 0)
  end
end

return response
