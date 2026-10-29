import { loadPackageScript } from "../package-scripts.mts";
import { registerScript } from "../scripts.mts";

export const CACHE_NAMESPACE = "cache";
export const INVALIDATION_MARKER_TTL_SECONDS = 60;

export const getValueWithTtlScript = registerScript(loadPackageScript("get-value-with-ttl.lua"));
export const getValuesWithTtlScript = registerScript(loadPackageScript("get-values-with-ttl.lua"));
export const cacheSetIfNotInvalidatedScript = registerScript(
  loadPackageScript("cache-set-if-not-invalidated.lua"),
);
export const cacheDeleteWithInvalidationScript = registerScript(
  loadPackageScript("cache-delete-with-invalidation.lua"),
);
