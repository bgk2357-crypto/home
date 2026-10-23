import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectRoot } from "./sites-env.mjs";

export function prepareLocalDb() {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "d1", "migrations", "apply", "DB", "--local",
    "--config", fileURLToPath(new URL("./local-db.json", import.meta.url)),
    "--persist-to", fileURLToPath(new URL("../.wrangler/state", import.meta.url)),
  ], { cwd: projectRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("로컬 데이터베이스 준비에 실패했습니다.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) prepareLocalDb();
