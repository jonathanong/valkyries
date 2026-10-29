import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { luaSources } from "../lua-sources.node.mts";

const root = new URL("../", import.meta.url);

describe("lua-sources", () => {
  it("leaves Node to read the Lua files from disk", () => {
    expect(luaSources).toBeUndefined();
  });

  it("embeds every script for Bun, each under its own file name", () => {
    const scripts = readdirSync(new URL("scripts/", root))
      .filter((name) => name.endsWith(".lua"))
      .sort();
    const bunSource = readFileSync(new URL("lua-sources.bun.mts", root), "utf8");
    const imports = [
      ...bunSource.matchAll(
        /^import (\w+) from "\.\/scripts\/([\w-]+\.lua)" with \{ type: "text" \};$/gm,
      ),
    ];
    const entries = [...bunSource.matchAll(/^ {2}"([\w-]+\.lua)": (\w+),$/gm)];

    expect(imports.map((match) => match[2]).sort()).toEqual(scripts);
    expect(entries.map((match) => match[1]).sort()).toEqual(scripts);
    const identifierByFile = new Map(imports.map((match) => [match[2], match[1]]));
    for (const [, file, identifier] of entries) expect(identifierByFile.get(file)).toBe(identifier);
  });
});
