import { memberAction } from "../../member-actions";
import { canWrite } from "../../../lib/membership";
import { uploadResource } from "../../resource-actions";
import { env } from "cloudflare:workers";
import { getUser } from "../../auth";
import { getMember } from "../../data";

export const dynamic = "force-dynamic";
function go(request: Request, path: string) { return Response.redirect(new URL(path, request.url), 303); }
function field(form: URLSearchParams, key: string, maximum: number, minimum = 1) {
  const all = form.getAll(key); if (all.length !== 1) return null;
  const value = all[0].trim(); return value.length >= minimum && value.length <= maximum && !value.includes("\0") ? value : null;
}
async function readForm(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 32768) { await reader.cancel(); return null; } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (["join","member-profile","paid-request","paid-cancel","admin-grade","admin-paid-review","qna-answer"].includes(action)) return memberAction(request,action);
  if (action === "safety-resources") return uploadResource(request);
  if (!["guestbook", "join", "qna", "community"].includes(action)) return new Response("Not found", { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response("다른 사이트에서의 제출은 허용하지 않습니다.", { status: 403 });
  const publicWrite = action === "guestbook";
  const user = publicWrite ? null : await getUser();
  if (!publicWrite && !user) return new Response("로그인 후 이용해주세요.", { status: 401, headers: { "Cache-Control": "no-store" } });
  const member = ["qna","community"].includes(action) ? await getMember(user!.userId) : null;
  if (["qna","community"].includes(action) && !canWrite(member)) return new Response("홈페이지 회원가입 후 작성할 수 있습니다.", { status: 403 });
  const form = await readForm(request); const path = action === "join" ? "/join" : `/${action}`;
  if (!form) return go(request, `${path}?error=invalid`);
  const db = env.DB; if (!db) return go(request, `${path}?error=busy`);
  const now = new Date().toISOString();
  try {
    if (action === "join") {
      const name = field(form, "displayName", 30, 2); if (!name) return go(request, "/join?error=invalid");
      if (form.get("consent") !== "yes") return go(request, "/join?error=consent");
      await db.prepare("INSERT INTO members (user_id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING").bind(user!.userId, name, now).run();
      return go(request, "/members?saved=1");
    }
    if (action === "guestbook") {
      const author = field(form, "author", 30); const body = field(form, "body", 500);
      if (!author || !body) return go(request, "/guestbook?error=invalid");
      const result = await db.prepare("INSERT INTO guestbook (author, body, created_at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM guestbook) < 2000").bind(author, body, now).run();
      return go(request, result.meta.changes ? "/guestbook?saved=1" : "/guestbook?error=capacity");
    }
    const title = field(form, "title", 100); const body = field(form, "body", 2000);
    if (!title || !body) return go(request, `${path}?error=invalid`);
    if (action === "community") {
      const author = member!.displayName;
      if (!author) return go(request, "/community?error=invalid");
      const result = await db.prepare("INSERT INTO posts (kind, user_id, author, title, body, created_at) SELECT 'community', ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM posts WHERE kind='community') < 10000").bind(user!.userId, author, title, body, now).run();
      return go(request, result.meta.changes ? "/community?saved=1" : "/community?error=capacity");
    }
    const result = await db.prepare("INSERT INTO posts (kind, user_id, author, title, body, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM posts WHERE user_id = ?) < 1000").bind(action, user!.userId, (member?.displayName ?? user!.displayName), title, body, now, user!.userId).run();
    return go(request, result.meta.changes ? `${path}?saved=1` : `${path}?error=capacity`);
  } catch { return go(request, `${path}?error=busy`); }
}
