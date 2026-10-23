import { env } from "cloudflare:workers";
export const dynamic = "force-dynamic";
export async function GET() {
  const runtime = (env as unknown as Record<string, unknown>).ARGO_RUNTIME === "node" ? "node" : "cloudflare";
  const checks = { connection: false, guestbook: false, community: false };
  try {
    if (!env.DB) throw new Error("Database unavailable");
    await env.DB.prepare("SELECT 1").first(); checks.connection = true;
    await env.DB.prepare("SELECT id, author, body, created_at FROM guestbook LIMIT 1").raw(); checks.guestbook = true;
    await env.DB.prepare("SELECT id, author, title, body, created_at FROM posts WHERE kind='community' LIMIT 1").raw(); checks.community = true;
    return Response.json({ status: "ok", runtime, checks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[health] Database / board query failed", error);
    return Response.json({ status: "unavailable", runtime, checks, reason: !checks.connection ? "database-connection" : !checks.guestbook ? "guestbook-query" : "community-query" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
