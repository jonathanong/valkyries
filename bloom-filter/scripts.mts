import { loadPackageScript } from "../package-scripts.mts";
import { registerScript } from "../scripts.mts";

export const bloomFilterExistsScript = registerScript(loadPackageScript("bloom-filter-exists.lua"));
export const bloomFilterMexistsScript = registerScript(
  loadPackageScript("bloom-filter-mexists.lua"),
);
export const bloomFilterExistsIfReadyScript = registerScript(
  loadPackageScript("bloom-filter-exists-if-ready.lua"),
);
export const bloomFilterMexistsIfReadyScript = registerScript(
  loadPackageScript("bloom-filter-mexists-if-ready.lua"),
);
export const bloomFilterAddScript = registerScript(loadPackageScript("bloom-filter-add.lua"));
export const bloomFilterReserveScript = registerScript(
  loadPackageScript("bloom-filter-reserve.lua"),
);
export const bloomFilterEnsureExistsScript = registerScript(
  loadPackageScript("bloom-filter-ensure-exists.lua"),
);

export const LUA_UNPACK_BATCH_SIZE = 5_000;
