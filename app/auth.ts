import { headers } from "next/headers";
import { safeReturnPath, sessionUser } from "./auth/session";

export async function getUser() { return sessionUser((await headers()).get("cookie") ?? ""); }
export function signInPath(returnTo: string) { return `/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`; }
export function signOutPath(returnTo = "/") { return `/auth/logout?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`; }
