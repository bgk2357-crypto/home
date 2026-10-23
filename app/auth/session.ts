import { setting } from "../runtime-config";

export type User = { userId: string; displayName: string; email: string; fullName: string | null };
export const SESSION_COOKIE = "argo_session";
export const FLOW_COOKIE = "argo_google_flow";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unbase64(value: string) { return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0)); }
export function randomToken() { return base64(crypto.getRandomValues(new Uint8Array(32))); }
async function key() {
  const secret = setting("AUTH_SECRET");
  if (secret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signValue(value: Record<string, unknown>) {
  const payload = base64(encoder.encode(JSON.stringify(value)));
  return `${payload}.${base64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(), encoder.encode(payload))))}`;
}
export async function readValue(value?: string): Promise<Record<string, unknown> | null> {
  if (!value || value.length > 6000) return null;
  try {
    const parts = value.split("."); if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify("HMAC", await key(), unbase64(parts[1]), encoder.encode(parts[0]))) return null;
    const parsed = JSON.parse(new TextDecoder().decode(unbase64(parts[0])));
    return typeof parsed.exp === "number" && parsed.exp > Date.now() / 1000 ? parsed : null;
  } catch { return null; }
}
export function cookieValue(header: string, name: string) {
  const matches = header.split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}
export function cookie(name: string, value: string, seconds: number, origin: string) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
export async function sessionUser(header: string): Promise<User | null> {
  const data = await readValue(cookieValue(header, SESSION_COOKIE));
  if (!data || data.type !== "session" || typeof data.userId !== "string" || !data.userId.startsWith("google:") || typeof data.email !== "string" || typeof data.displayName !== "string") return null;
  return { userId: data.userId, email: data.email, displayName: data.displayName, fullName: typeof data.fullName === "string" ? data.fullName : null };
}
export function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const url = new URL(value, "https://app.local");
  if (url.origin !== "https://app.local" || url.pathname.startsWith("/auth/") || url.pathname === "/login") return "/";
  return url.pathname + url.search + url.hash;
}
export async function codeChallenge(verifier: string) { return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)))); }
