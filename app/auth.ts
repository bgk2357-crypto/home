import { ensureMember } from "./member-store";
import { headers } from "next/headers";
import { safeReturnPath, sessionUser } from "./auth/session";

export async function getUser() { const user=await sessionUser((await headers()).get("cookie") ?? ""); if(!user)return null;const member=await ensureMember(user);return {...user,role:member?.role||"preliminary"}; }
export function signInPath(returnTo: string) { return `/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`; }
export function signOutPath(returnTo = "/") { return `/auth/logout?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`; }
