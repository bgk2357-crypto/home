import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
mkdirSync(new URL("public/vendor/", root), { recursive: true });
copyFileSync(fileURLToPath(new URL("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", root)), fileURLToPath(new URL("public/vendor/pdf.worker.min.mjs", root)));
