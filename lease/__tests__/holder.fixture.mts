// Child process fixture: acquires a lease, then dies without releasing or renewing it.
// It inherits the parent's environment, so the cache client targets the test's server.
import { cacheValkeyClient } from "../../clients.mts";
import { acquireRenewableLease } from "../../lease.mts";

const [key = ""] = process.argv.slice(2);
const lease = await acquireRenewableLease(key, { ttlMs: 60_000, client: cacheValkeyClient });
process.kill(process.pid, lease ? "SIGKILL" : "SIGTERM");
