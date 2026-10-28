// Installs the packed package into a scratch Bun app, then runs it under the Bun runtime and as a
// `bun build --compile` executable whose install directory has been deleted. Run under Bun after
// `pnpm run build`, with Valkey reachable through the usual VALKEY_* variables.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bun = process.execPath;
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

// The dynamic root import is the shape that loses top-level await through `export *` when bundled.
const entry = `
const { RateLimiter, acquireRenewableLease, cacheValkeyClient } = await import("valkyries");
if (typeof cacheValkeyClient?.ping !== "function") throw new Error("cacheValkeyClient is not initialized");
const prefix = "bun-smoke:" + crypto.randomUUID();
try {
  const limiter = new RateLimiter({ prefix, ttlSeconds: 60 });
  const result = await limiter.addAndCheck(["id"], 5);
  if (JSON.stringify(result) !== JSON.stringify({ counts: [1], limited: false })) {
    throw new Error("unexpected rate limiter result " + JSON.stringify(result));
  }
  const lease = await acquireRenewableLease(prefix + ":lease", { ttlMs: 10_000, client: cacheValkeyClient });
  if (!lease?.isHeld) throw new Error("lease was not acquired");
  if ((await lease.release()) !== true) throw new Error("lease release did not delete its key");
} finally {
  await cacheValkeyClient.unlink(["rate-limiter:" + prefix + ":{id}"]);
}
console.log("valkyries bun smoke ok");
process.exit(0);
`;

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function expectOk(label: string, output: string): void {
  if (!output.includes("valkyries bun smoke ok")) {
    throw new Error(`${label} did not finish:\n${output}`);
  }
  console.log(`${label}: ok`);
}

const work = mkdtempSync(join(tmpdir(), "valkyries-bun-"));
try {
  run("pnpm", ["pack", "--pack-destination", work], repoRoot);
  const tarball = readdirSync(work).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack produced no tarball");

  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module", private: true }));
  writeFileSync(join(app, "entry.mjs"), entry);
  run(bun, ["add", join(work, tarball)], app);
  expectOk("bun runtime", run(bun, ["entry.mjs"], app));

  const bin = join(work, "bin");
  mkdirSync(bin);
  run(bun, ["build", "--compile", "entry.mjs", "--outfile", join(bin, "smoke")], app);
  // The executable must not depend on the installed package files.
  rmSync(app, { recursive: true, force: true });
  expectOk("bun build --compile", run(join(bin, "smoke"), [], bin));
} finally {
  rmSync(work, { recursive: true, force: true });
}
