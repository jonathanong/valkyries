import { loadScript, registerScript } from "../scripts.mts";

export const bloomFilterExistsScript = registerScript(
  loadScript("bloom-filter-exists.lua", new URL("../", import.meta.url)),
);
export const bloomFilterMexistsScript = registerScript(
  loadScript("bloom-filter-mexists.lua", new URL("../", import.meta.url)),
);
export const bloomFilterExistsIfReadyScript = registerScript(
  loadScript("bloom-filter-exists-if-ready.lua", new URL("../", import.meta.url)),
);
export const bloomFilterMexistsIfReadyScript = registerScript(
  loadScript("bloom-filter-mexists-if-ready.lua", new URL("../", import.meta.url)),
);
export const bloomFilterAddScript = registerScript(
  loadScript("bloom-filter-add.lua", new URL("../", import.meta.url)),
);
export const bloomFilterReserveScript = registerScript(
  loadScript("bloom-filter-reserve.lua", new URL("../", import.meta.url)),
);
export const bloomFilterEnsureExistsScript = registerScript(
  loadScript("bloom-filter-ensure-exists.lua", new URL("../", import.meta.url)),
);

export const LUA_UNPACK_BATCH_SIZE = 5_000;
