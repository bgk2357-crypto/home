import { env } from "cloudflare:workers";

export function setting(name: string): string {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value : process.env[name] ?? "";
}
