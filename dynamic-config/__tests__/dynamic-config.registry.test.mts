import { describe, expect, it } from "vitest";
import {
  createDynamicConfigRegistry,
  defineDynamicConfigNamespace,
  withMaxValueExemption,
} from "../registry.mts";

const config = { fieldTypes: { a: "number", b: "number" } } as const;

describe("dynamic-config.registry", () => {
  it("defineDynamicConfigNamespace returns definitions whose rules match fieldTypes", () => {
    const definition = { namespace: "n", config, fields: { a: {}, b: {} }, label: "extra" };
    expect(defineDynamicConfigNamespace(definition)).toBe(definition);
  });

  it("defineDynamicConfigNamespace reports missing and extra rules", () => {
    expect(() =>
      defineDynamicConfigNamespace({ namespace: "n", config, fields: { a: {} } }),
    ).toThrow("DynamicConfig field rules drift for n: missing rules: b");
    expect(() =>
      defineDynamicConfigNamespace({ namespace: "n", config, fields: { a: {}, b: {}, c: {} } }),
    ).toThrow("drift for n: extra rules: c");
    expect(() =>
      defineDynamicConfigNamespace({ namespace: "n", config, fields: { c: {} } }),
    ).toThrow("missing rules: a, b; extra rules: c");
    expect(() =>
      defineDynamicConfigNamespace({ namespace: "n", config, fields: { a: {}, toString: {} } }),
    ).toThrow("missing rules: b; extra rules: toString");
  });

  it("withMaxValueExemption exempts unbounded fields except the named ones", () => {
    expect(withMaxValueExemption({ a: { maxValue: 3 }, b: {}, c: {} }, "why", ["c"])).toEqual({
      a: { maxValue: 3 },
      b: { maxValueExemption: "why" },
      c: {},
    });
    expect(withMaxValueExemption({ a: {} }, "why")).toEqual({ a: { maxValueExemption: "why" } });
    const proto = withMaxValueExemption(JSON.parse('{"__proto__":{}}'), "why");
    expect(Object.hasOwn(proto, "__proto__")).toBe(true);
  });

  it("createDynamicConfigRegistry looks up entries and rejects duplicate namespaces", () => {
    const entry = defineDynamicConfigNamespace({
      namespace: "n",
      config,
      fields: { a: {}, b: {} },
    });
    const entries = [entry];
    const registry = createDynamicConfigRegistry(entries);
    entries.pop();
    expect(registry.get("n")).toBe(entry);
    expect(registry.get("other")).toBeNull();
    expect(registry.entries).toEqual([entry]);
    expect(() => createDynamicConfigRegistry([entry, entry])).toThrow(
      "Duplicate dynamic config namespace: n",
    );
  });
});
