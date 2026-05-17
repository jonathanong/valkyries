import { cpSync } from "node:fs";

cpSync(new URL("../scripts/", import.meta.url), new URL("../dist/scripts/", import.meta.url), {
  recursive: true,
});
