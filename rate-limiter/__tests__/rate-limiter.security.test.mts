import { RateLimiter } from "../../rate-limiter.mts";
import { it, expect, describe, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("node:crypto", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:crypto")>();
  return {
    ...mod,
    randomUUID: vi.fn().mockReturnValue("mocked-uuid"),
  };
});

describe("RateLimiter Security", () => {
  const client = {
    invokeScript: vi.fn().mockResolvedValue([1]),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("add() uses randomUUID()", async () => {
    const rateLimiter = new RateLimiter({ prefix: "test", ttlSeconds: 10, client });
    await rateLimiter.add(["user-1"]);

    expect(randomUUID).toHaveBeenCalled();
    const args = client.invokeScript.mock.calls[0][1].args;
    expect(args).toContain("mocked-uuid");
  });

  it("addAndCheck() uses randomUUID()", async () => {
    const rateLimiter = new RateLimiter({ prefix: "test", ttlSeconds: 10, client });
    await rateLimiter.addAndCheck(["user-1"], 5);

    expect(randomUUID).toHaveBeenCalled();
    const args = client.invokeScript.mock.calls[0][1].args;
    expect(args).toContain("mocked-uuid");
  });
});
