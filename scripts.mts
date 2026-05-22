import { readFileSync } from "node:fs";
import { Script } from "@valkey/valkey-glide";

const scriptRegistry: Script[] = [];
let releaseHookRegistered = false;

function registerReleaseHook() {
  if (releaseHookRegistered) return;
  releaseHookRegistered = true;
  process.once("exit", () => {
    for (let i = 0; i < scriptRegistry.length; i++) {
      try {
        scriptRegistry[i].release();
      } catch (err) {
        // oxlint-disable-next-line no-console -- synchronous; onError queues async Sentry I/O which won't flush in an exit handler
        console.error(err);
      }
    }
  });
}

export function registerScript(code: string): Script {
  registerReleaseHook();
  const script = new Script(code);
  scriptRegistry.push(script);
  return script;
}

export function loadScript(relativePath: string, baseUrl: string | URL): string {
  const fileUrl = new URL(`./scripts/${relativePath}`, baseUrl);
  return readFileSync(fileUrl, "utf8");
}
