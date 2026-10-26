// Child process fixture: acquires a lease, then dies without releasing or renewing it.
import { GlideClient } from "@valkey/valkey-glide";
import { acquireRenewableLease } from "../../lease.mts";

const [key = "", url = ""] = process.argv.slice(2);
const parsed = new URL(url);
const client = await GlideClient.createClient({
  addresses: [{ host: parsed.hostname, port: Number(parsed.port) }],
});
const lease = await acquireRenewableLease(key, { ttlMs: 60_000, client });
process.kill(process.pid, lease ? "SIGKILL" : "SIGTERM");
