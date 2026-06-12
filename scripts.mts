import { readFileSync } from "node:fs";
import { Script } from "@valkey/valkey-glide";

const scriptRegistry: Script[] = [];
let releaseHookRegistered = false;

function registerReleaseHook() {
  if (releaseHookRegistered) return;
  releaseHookRegistered = true;
  process.once("exit", () => {
    for (const script of scriptRegistry) {
      try {
        script.release();
      } catch (err) {
        process.stderr.write(`${String(err)}\n`);
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
