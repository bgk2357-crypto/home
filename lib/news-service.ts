import { env } from "cloudflare:workers";
import { NEWS_SOURCES, type NewsArticle, type NewsKind, type NewsSource } from "./news-sources";
import { deduplicateArticles, parseBoard, parseKosha, parseRss } from "./news-parser";

export const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
type Snapshot = { items: NewsArticle[]; fetchedAt: string | null; checkedAt: string; failed: boolean };
type CacheRow = { items_json: string; fetched_at: string | null; checked_at: string; failed: number };
export type SourceStatus = { id: string; name: string; homepage: string; count: number; fetchedAt: string | null; checkedAt: string; status: "ok" | "stale" | "unavailable" };
export type NewsResult = { articles: NewsArticle[]; sources: SourceStatus[]; generatedAt: string; refreshMinutes: number };
const memory = new Map<string, Snapshot>();
const pending = new Map<string, Promise<Snapshot>>();

async function readCache(id: string): Promise<Snapshot | null> {
  try {
    const row = await env.DB?.prepare("SELECT items_json, fetched_at, checked_at, failed FROM news_feed_cache WHERE source_id = ?").bind(id).first<CacheRow>();
    if (row) return { items: JSON.parse(row.items_json), fetchedAt: row.fetched_at, checkedAt: row.checked_at, failed: !!row.failed };
  } catch { /* An unavailable DB must not prevent public news from loading. */ }
  return memory.get(id) ?? null;
}
async function saveCache(id: string, snapshot: Snapshot) {
  memory.set(id, snapshot);
  try {
    await env.DB?.prepare("INSERT INTO news_feed_cache (source_id, items_json, fetched_at, checked_at, failed) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET items_json=excluded.items_json, fetched_at=excluded.fetched_at, checked_at=excluded.checked_at, failed=excluded.failed")
      .bind(id, JSON.stringify(snapshot.items), snapshot.fetchedAt, snapshot.checkedAt, snapshot.failed ? 1 : 0).run();
  } catch { /* Keep the in-memory snapshot if persistent storage is unavailable. */ }
}
async function readResponse(response: Response) {
  if (!response.ok) throw new Error(`source-http-${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error("empty-response");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length; if (length > 1_500_000) { await reader.cancel(); throw new Error("source-too-large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const declaredCharset = response.headers.get("content-type")?.match(/charset=([^;\s]+)/i)?.[1];
  const metaCharset = new TextDecoder().decode(bytes.slice(0, 1500)).match(/charset=["']?([\w-]+)/i)?.[1];
  return new TextDecoder(declaredCharset || metaCharset || "utf-8").decode(bytes);
}
export async function fetchSource(source: NewsSource): Promise<NewsArticle[]> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(source.url, {
      method: source.method ?? "GET", signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/html, application/json", ...(source.method === "POST" ? { "Content-Type": "application/json", chnlId: "portal24" } : {}) },
      ...(source.method === "POST" ? { body: "{}" } : {}),
    });
    const body = await readResponse(response);
    const items = source.format === "kosha" ? parseKosha(JSON.parse(body), source) : source.format === "board" ? parseBoard(body, source) : parseRss(body, source);
    const now = Date.now(); const oldest = now - (source.kind === "general" ? 30 : 180) * 86400000;
    return deduplicateArticles(items).filter(item => !item.publishedAt || (Date.parse(item.publishedAt) <= now + 86400000 && Date.parse(item.publishedAt) >= oldest)).slice(0, 100);
  } finally { clearTimeout(timeout); }
}
async function refresh(source: NewsSource): Promise<Snapshot> {
  const previous = await readCache(source.id); const now = Date.now();
  if (previous && now - Date.parse(previous.checkedAt) < (previous.failed ? RETRY_MS : REFRESH_MS)) return previous;
  let snapshot: Snapshot;
  try {
    snapshot = { items: await fetchSource(source), fetchedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), failed: false };
  } catch {
    const usable = previous?.fetchedAt && now - Date.parse(previous.fetchedAt) < MAX_STALE_MS;
    snapshot = { items: usable ? previous.items : [], fetchedAt: usable ? previous.fetchedAt : null, checkedAt: new Date().toISOString(), failed: true };
  }
  await saveCache(source.id, snapshot); return snapshot;
}
async function sourceSnapshot(source: NewsSource) {
  let request = pending.get(source.id);
  if (!request) { request = refresh(source).finally(() => pending.delete(source.id)); pending.set(source.id, request); }
  return request;
}
export async function getNews(kind: NewsKind): Promise<NewsResult> {
  const sources = NEWS_SOURCES.filter(source => source.kind === kind);
  const snapshots: Snapshot[] = [];
  // Bound outgoing concurrency on the Worker runtime.
  for (let offset = 0; offset < sources.length; offset += 4) snapshots.push(...await Promise.all(sources.slice(offset, offset + 4).map(sourceSnapshot)));
  const articles = deduplicateArticles(snapshots.flatMap(snapshot => snapshot.items)).slice(0, 150);
  return {
    articles, generatedAt: new Date().toISOString(), refreshMinutes: REFRESH_MS / 60000,
    sources: sources.map((source, index) => ({ id: source.id, name: source.name, homepage: source.homepage, count: snapshots[index].items.length, fetchedAt: snapshots[index].fetchedAt, checkedAt: snapshots[index].checkedAt,
      status: snapshots[index].failed ? snapshots[index].fetchedAt ? "stale" : "unavailable" : "ok" })),
  };
}
