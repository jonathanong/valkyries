import { luaSources } from "#lua-sources";
import { loadScript } from "./scripts.mts";

/** Loads one of this package's own scripts from `scripts/`. */
export function loadPackageScript(name: string): string {
  // Under Bun the scripts are imported as text, so compiled executables read no files.
  return luaSources?.[name] ?? loadScript(name, import.meta.url);
}
