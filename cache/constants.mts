import { loadScript, registerScript } from "../scripts.mts";

export const CACHE_NAMESPACE = "cache";
export const INVALIDATION_MARKER_TTL_SECONDS = 60;

export const getValueWithTtlScript = registerScript(
  loadScript("get-value-with-ttl.lua", new URL("../", import.meta.url)),
);
export const getValuesWithTtlScript = registerScript(
  loadScript("get-values-with-ttl.lua", new URL("../", import.meta.url)),
);
export const cacheSetIfNotInvalidatedScript = registerScript(
  loadScript("cache-set-if-not-invalidated.lua", new URL("../", import.meta.url)),
);
export const cacheDeleteWithInvalidationScript = registerScript(
  loadScript("cache-delete-with-invalidation.lua", new URL("../", import.meta.url)),
);
