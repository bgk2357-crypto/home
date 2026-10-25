export type User = { userId: string; displayName: string; email: string; fullName: string | null };
export type Member = { userId: string; displayName: string; createdAt: string };
export type Entry = { id: number; author: string; body: string; createdAt: string };
export type Post = Entry & { kind: string; title: string; userId: string };
export type PageData<T> = { items: T[]; total: number; current: number; pages: number };
export type Context = { user: User | null; member: Member | null; entries: PageData<Entry>; posts: PageData<Post>; selected: Post | null; googleReady: boolean; mapKey: string; csrf: string };
export let context: Context;
export function setContext(value: Context) { context = value; }
export function routeUrl(path: string) {
  const url = new URL(path, location.origin);
  const result = new URL('/index.php', location.origin);
  result.searchParams.set('route', url.pathname);
  url.searchParams.forEach((value, name) => { if (name !== 'route') result.searchParams.append(name, value); });
  result.hash = url.hash;
  return result.pathname + result.search + result.hash;
}
