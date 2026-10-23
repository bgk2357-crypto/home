import { fileURLToPath } from "node:url";
if (process.env.RENDER === "true") {
  process.env.VINEXT_TRUST_PROXY = "1";
  if (process.env.RENDER_EXTERNAL_HOSTNAME) process.env.VINEXT_TRUSTED_HOSTS = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (!process.env.SQLITE_PATH?.startsWith("/var/data/")) console.warn("SQLite is using temporary storage. Attach a persistent disk at /var/data and set SQLITE_PATH=/var/data/argo.sqlite to retain posts across redeploys.");
}
const cli = new URL("../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), "start", "--hostname", "0.0.0.0"];
await import(cli.href);
