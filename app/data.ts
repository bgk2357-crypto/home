import { isMaster } from "../lib/membership";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { guestbook, members, posts } from "../db/schema";
export async function getMember(userId?: string) { if (!userId) return null; return await getDb().select().from(members).where(eq(members.userId, userId)).get() ?? null; }
export async function getEntries(page: number) {
  const db = getDb(); const total = (await db.select({ total: count() }).from(guestbook).get())?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 10)); const current = Math.min(page, pages);
  const items = await db.select().from(guestbook).orderBy(desc(guestbook.id)).limit(10).offset((current - 1) * 10);
  return { items, total, pages, current };
}
export async function getPosts(kind: "qna" | "community", page: number, userId?: string) {
  const db = getDb(); const master = kind === "qna" && isMaster(await getMember(userId)); const where = kind === "qna" && !master ? and(eq(posts.kind, kind), eq(posts.userId, userId ?? "")) : eq(posts.kind, kind);
  const total = (await db.select({ total: count() }).from(posts).where(where).get())?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 10)); const current = Math.min(page, pages);
  const items = await db.select().from(posts).where(where).orderBy(desc(posts.id)).limit(10).offset((current - 1) * 10);
  return { items, total, pages, current };
}
export function displayDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
export function pageNumber(value?: string) { const page = Number(value); return Number.isInteger(page) && page >= 1 ? Math.min(page, 10000) : 1; }
export async function getCommunityPost(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return await getDb().select().from(posts).where(and(eq(posts.id, id), eq(posts.kind, "community"))).get() ?? null;
}
