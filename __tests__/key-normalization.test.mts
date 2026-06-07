import { describe, expect, it } from "vitest";

import { normalizeKey } from "../key-normalization.mts";

describe("normalizeKey", () => {
  it("replaces curly braces with underscores", () => {
    expect(normalizeKey("user:{123}")).toBe("user__123_");
    expect(normalizeKey("{user}123")).toBe("_user_123");
  });

  it("replaces colons with underscores", () => {
    expect(normalizeKey("user:profile:123")).toBe("user_profile_123");
    expect(normalizeKey(":user:123:")).toBe("_user_123_");
  });

  it("replaces both curly braces and colons with underscores", () => {
    expect(normalizeKey("{user}:profile:{123}")).toBe("_user__profile__123_");
  });

  it("does not modify keys without curly braces or colons", () => {
    expect(normalizeKey("user_profile_123")).toBe("user_profile_123");
    expect(normalizeKey("simplekey")).toBe("simplekey");
  });

  it("handles empty strings", () => {
    expect(normalizeKey("")).toBe("");
  });
});
