import { setting } from "../../runtime-config";
import { codeChallenge, cookie, FLOW_COOKIE, randomToken, safeReturnPath, signValue,sessionUser } from "../session";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = setting("APP_ORIGIN").replace(/\/$/, "");
  if (!setting("GOOGLE_CLIENT_ID") || !setting("GOOGLE_CLIENT_SECRET") || setting("AUTH_SECRET").length < 32 || !origin) {
    return Response.redirect(new URL("/login?error=configuration", url), 303);
  }
  if (origin !== url.origin) return Response.redirect(new URL("/login?error=origin", url), 303);
  const state = randomToken(); const verifier = randomToken();
  const user=await sessionUser(request.headers.get('cookie')||'');
  if(url.searchParams.get('link')==='1'&&!user)return Response.redirect(new URL('/login?error=authentication',url),303);
  const flow = await signValue({ type: "oauth", state, verifier, returnTo: safeReturnPath(url.searchParams.get("return_to")),linkUserId:url.searchParams.get('link')==='1'?user?.userId:null, exp: Math.floor(Date.now() / 1000) + 600 });
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({ client_id: setting("GOOGLE_CLIENT_ID"), redirect_uri: `${origin}/auth/google/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: await codeChallenge(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
  return new Response(null, { status: 303, headers: { Location: google.toString(), "Set-Cookie": cookie(FLOW_COOKIE, flow, 600, origin), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
