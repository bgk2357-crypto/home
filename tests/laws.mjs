import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const folder = new URL("../.sites-runtime/tests/", import.meta.url);
await mkdir(folder, { recursive: true });
await build({ entryPoints: ["app/legal-resources.tsx", "app/laws.ts"], outdir: fileURLToPath(folder), bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic" });
const { LegalResources } = await import(new URL("legal-resources.js", folder));
const { lawGroups, lawSearchUrl, lawTextUrl } = await import(new URL("laws.js", folder));
let checks = 0;
function check(value, expected) { assert.equal(value, expected); checks++; }
check(lawGroups["/resources/osh-law"].items.length, 5);
check(lawGroups["/resources/serious-law"].items.length, 2);
for (const [path, group] of Object.entries(lawGroups)) {
  const html = renderToStaticMarkup(React.createElement(LegalResources, { path }));
  check(html.includes('action="https://www.law.go.kr/lsSc.do"'), true);
  check(html.includes('method="get"'), true);
  check(html.includes("법제처 국가법령정보센터 검색"), true);
  check(html.includes('name="query"'), true);
  check(html.includes('target="_blank"'), true);
  check(html.includes("법령체계도"), true);
  for (const item of group.items) {
    check(html.includes(item.title), true);
    check(new URL(lawTextUrl(item.name)).hostname, "www.law.go.kr");
    check(decodeURIComponent(new URL(lawTextUrl(item.name)).pathname), "/법령/" + item.name);
    check(new URL(lawSearchUrl(item.title)).searchParams.get("query"), item.title);
  }
}
const encoded = new URL(lawSearchUrl("산업안전보건법 & 시행규칙"));
check(encoded.searchParams.get("query"), "산업안전보건법 & 시행규칙");
check(encoded.searchParams.get("menuId"), "1");
console.log(checks + " law-resource checks passed: statute links, subordinate regulations, GET search and query encoding.");
