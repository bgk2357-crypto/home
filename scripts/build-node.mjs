import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(process.execPath, [fileURLToPath(new URL("./run-framework.mjs", import.meta.url)), "build"], {
  stdio: "inherit", env: { ...process.env, DEPLOY_TARGET: "node" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
