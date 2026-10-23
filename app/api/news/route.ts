import { getNews } from "../../../lib/news-service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "trends" && kind !== "general") return Response.json({ error: "invalid-kind" }, { status: 400 });
  return Response.json(await getNews(kind), { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
