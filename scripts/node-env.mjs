import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

let database;
export function openDatabase(filename = process.env.SQLITE_PATH || path.resolve(".data/argo.sqlite")) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  sqlite.exec("CREATE TABLE IF NOT EXISTS _argo_migrations (name TEXT PRIMARY KEY NOT NULL)");
  for (const name of readdirSync(path.resolve("drizzle")).filter(name => name.endsWith(".sql")).sort()) {
    if (sqlite.prepare("SELECT name FROM _argo_migrations WHERE name = ?").get(name)) continue;
    sqlite.exec("BEGIN IMMEDIATE");
    try { sqlite.exec(readFileSync(path.resolve("drizzle", name), "utf8")); sqlite.prepare("INSERT INTO _argo_migrations(name) VALUES (?)").run(name); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }
  function prepare(sql, parameters = []) {
    function statement() { return sqlite.prepare(sql); }
    return {
      bind(...values) { return prepare(sql, values); },
      async first(column) { const row = statement().get(...parameters); return row ? column ? row[column] : row : null; },
      async run() { const result = statement().run(...parameters); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      async all() { return { success: true, results: statement().all(...parameters), meta: {} }; },
      async raw(options) {
        const prepared = statement();
        // Older Node 22 releases expose node:sqlite without setReturnArrays.
        // Drizzle's D1 driver needs arrays, even when SELECT 1 / first() succeeds.
        const nativeArrays = typeof prepared.setReturnArrays === "function";
        if (nativeArrays) prepared.setReturnArrays(true);
        const result = prepared.all(...parameters);
        const rows = nativeArrays ? result : result.map(row => Object.values(row));
        const names = typeof prepared.columns === "function" ? prepared.columns().map(column => column.name) : result.length ? Object.keys(result[0]) : [];
        return options?.columnNames ? [names, ...rows] : rows;
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
    async exec(sql) { sqlite.exec(sql); return { count: 1, duration: 0 }; },
    close() { sqlite.close(); },
  };
}
// The Node build resolves cloudflare:workers to this server-only adapter.
export const env = new Proxy({}, { get(_target, key) {
  if (key === "DB") return database ??= openDatabase();
  if (key === "ARGO_RUNTIME") return "node";
  if (key === "APP_ORIGIN") return process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || "";
  return process.env[key];
} });
