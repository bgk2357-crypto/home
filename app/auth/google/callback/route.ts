import { setting } from "../../../runtime-config";
import { cookie, cookieValue, FLOW_COOKIE, readValue, safeReturnPath, SESSION_COOKIE, SESSION_SECONDS, signValue } from "../../session";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = setting("APP_ORIGIN").replace(/\/$/, "");
  const responseHeaders = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  responseHeaders.append("Set-Cookie", cookie(FLOW_COOKIE, "", 0, url.origin));
  const failure = (error: string) => { responseHeaders.set("Location", new URL(`/login?error=${error}`, url).toString()); return new Response(null, { status: 303, headers: responseHeaders }); };
  const flow = await readValue(cookieValue(request.headers.get("cookie") ?? "", FLOW_COOKIE));
  const code = url.searchParams.get("code");
  if (url.origin !== origin || !flow || flow.type !== "oauth" || typeof flow.state !== "string" || flow.state !== url.searchParams.get("state") || typeof flow.verifier !== "string" || !code || url.searchParams.has("error")) return failure("cancelled");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: setting("GOOGLE_CLIENT_ID"), client_secret: setting("GOOGLE_CLIENT_SECRET"), code, grant_type: "authorization_code", redirect_uri: `${origin}/auth/google/callback`, code_verifier: flow.verifier }), signal: AbortSignal.timeout(15000) });
    if (!tokenResponse.ok) return failure("failed");
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return failure("failed");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!profileResponse.ok) return failure("failed");
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
    if (!profile.sub || !profile.email || profile.email_verified !== true) return failure("failed");
    const session = await signValue({ type: "session", userId: `google:${profile.sub}`, email: profile.email, displayName: (profile.name || profile.email).slice(0, 100), fullName: profile.name?.slice(0, 100) ?? null, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });
    responseHeaders.append("Set-Cookie", cookie(SESSION_COOKIE, session, SESSION_SECONDS, origin));
    responseHeaders.set("Location", new URL(safeReturnPath(typeof flow.returnTo === "string" ? flow.returnTo : null), origin).toString());
    return new Response(null, { status: 303, headers: responseHeaders });
  } catch { return failure("failed"); }
}
