import { cookie, safeReturnPath, SESSION_COOKIE, FLOW_COOKIE } from "../session";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const headers = new Headers({ Location: new URL(safeReturnPath(url.searchParams.get("return_to")), url).toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0, url.origin));
  headers.append("Set-Cookie", cookie(FLOW_COOKIE, "", 0, url.origin));
  return new Response(null, { status: 303, headers });
}
