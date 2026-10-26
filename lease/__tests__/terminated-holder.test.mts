import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { acquireRenewableLease } from "../../lease.mts";
import { pttl, realClient, uniqueKey } from "./helpers.mts";

const fixture = new URL("./holder.fixture.mts", import.meta.url).pathname;

function runHolder(key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture, key], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (_code, signal) => resolve(signal));
  });
}

describe("terminated holder", () => {
  it("lets another process acquire once the dead holder's key expires", async () => {
    const key = uniqueKey("terminated");
    try {
      await expect(runHolder(key)).resolves.toBe("SIGKILL");

      // The dead holder left a finite-TTL key behind and nothing renews it.
      const ttl = await pttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60_000);
      await expect(
        acquireRenewableLease(key, { ttlMs: 5000, client: realClient }),
      ).resolves.toBeNull();

      // Controlled server-side expiry of this test's own key (an expiry time in the past).
      await realClient.customCommand(["PEXPIREAT", key, "1"]);
      const lease = await acquireRenewableLease(key, { ttlMs: 5000, client: realClient });
      expect(lease).not.toBeNull();
      await lease!.release();
    } finally {
      await realClient.unlink([key]);
    }
  });
});
