import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// 실제 SQLite와 운영 스키마를 사용하고 D1 연결·로그인 정보 주입만 대체합니다.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(await readFile(new URL('../drizzle/0000_gigantic_miracleman.sql', import.meta.url), 'utf8'));
globalThis.testHeaders = new Headers();
globalThis.testEnv = { AUTH_SECRET: 'test-only-secret-with-more-than-32-characters', DB: { prepare(sql) {
  let parameters = [];
  return { bind(...values) { parameters = values; return this; },
    async run() { const result = sqlite.prepare(sql).run(...parameters); return { success: true, meta: { changes: Number(result.changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...parameters), success: true }; },
    async raw() { const statement = sqlite.prepare(sql); statement.setReturnArrays(true); return statement.all(...parameters); },
  };
} } };
const output = new URL('../.sites-runtime/tests/', import.meta.url);
await mkdir(output, { recursive: true });
const replacements = { name: 'test-runtime', setup(context) {
  context.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare', namespace: 'test' }));
  context.onResolve({ filter: /^next\/headers$/ }, () => ({ path: 'headers', namespace: 'test' }));
  context.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'test' }));
  context.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'cloudflare' ? 'export const env = globalThis.testEnv;' : path === 'headers' ? 'export async function headers(){return globalThis.testHeaders;}' : 'export function redirect(path){throw new Error(path);}' }));
} };
for (const [name, entry] of [['route', 'app/actions/[action]/route.ts'], ['data', 'app/data.ts'], ['session', 'app/auth/session.ts']]) {
  await build({ entryPoints: [entry], outfile: fileURLToPath(new URL(`${name}.mjs`, output)), bundle: true, platform: 'node', format: 'esm', plugins: [replacements] });
}
const { POST } = await import(new URL('route.mjs', output));
const data = await import(new URL('data.mjs', output));
const session = await import(new URL('session.mjs', output));
let checks = 0;
function check(value, expected) { assert.equal(value, expected); checks++; }
async function signIn(id) { globalThis.testHeaders = new Headers(id ? { cookie: 'argo_session=' + await session.signValue({ type: 'session', userId: id, displayName: id, email: id + '@example.test', exp: Date.now()/1000 + 600 }) } : {}); }
async function submit(action, values, origin = 'https://test.local') {
  const request = new Request(`https://test.local/actions/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin }, body: new URLSearchParams(values) });
  return POST(request, { params: Promise.resolve({ action }) });
}
await signIn(null);
check((await submit('qna', { title: '문의', body: '안녕하세요' })).status, 401);
check((await submit('community', { title: '이야기', body: '안녕하세요' })).headers.get('location'), 'https://test.local/community?error=invalid');
check((await submit('guestbook', { author: '방문자', body: '응원합니다' })).headers.get('location'), 'https://test.local/guestbook?saved=1');
check((await data.getEntries(1)).total, 1);
check((await submit('guestbook', { author: '  ', body: '내용' })).headers.get('location'), 'https://test.local/guestbook?error=invalid');
check((await submit('guestbook', { author: '가'.repeat(31), body: '내용' })).headers.get('location'), 'https://test.local/guestbook?error=invalid');
check((await submit('guestbook', { author: '방문자', body: '나'.repeat(501) })).headers.get('location'), 'https://test.local/guestbook?error=invalid');
check((await submit('guestbook', { author: '방문자', body: '내용' }, 'https://other.test')).status, 403);
await submit('guestbook', { author: "';DROP TABLE members", body: '<script>alert(1)</script>' });
check((await data.getEntries(1)).total, 2);
check((await data.getEntries(1)).items[0].body, '<script>alert(1)</script>');
await signIn('google:alice');
check((await submit('qna', { title: '문의', body: '내용' })).status, 403);
check((await submit('join', { displayName: '회원A' })).headers.get('location'), 'https://test.local/join?error=consent');
check(await data.getMember('google:alice'), null);
check((await submit('join', { displayName: '회원A', consent: 'yes' })).headers.get('location'), 'https://test.local/members?saved=1');
check((await data.getMember('google:alice')).displayName, '회원A');
await submit('join', { displayName: '중복가입', consent: 'yes' });
check((await data.getMember('google:alice')).displayName, '회원A');
check((await submit('qna', { title: '비공개 문의', body: '문의 내용', userId: 'google:bob', author: '가짜이름' })).headers.get('location'), 'https://test.local/qna?saved=1');
check((await data.getPosts('qna', 1, 'google:alice')).total, 1);
check((await data.getPosts('qna', 1, 'google:alice')).items[0].author, '회원A');
check((await data.getPosts('qna', 1, 'google:bob')).total, 0);
await submit('community', { author: '비회원 A', title: '공개 이야기', body: '함께 나누는 글' });
await signIn(null);
check((await data.getPosts('community', 1)).total, 1);
for (let index = 0; index < 10; index++) await submit('guestbook', { author: '방문자', body: `글${index}` });
check((await data.getEntries(1)).items.length, 10);
check((await data.getEntries(2)).items.length, 2);
check((await data.getEntries(1)).items[0].body, '글9');
check((await data.getEntries(9999)).current, 2);
check((await submit('missing', {})).status, 404);
check(data.pageNumber('-1'), 1);
check(data.pageNumber('abc'), 1);
check(data.pageNumber('100000'), 10000);
check(await session.sessionUser('argo_session=forged.value'), null);
const expired = await session.signValue({type:'session',userId:'google:expired',email:'e@test',displayName:'expired',exp:1});
check(await session.sessionUser('argo_session='+expired), null);
check(session.safeReturnPath('//evil.test'), '/');
check(session.safeReturnPath('/community?write=1'), '/community?write=1');
await signIn('google:unregistered');
check((await submit('community', {author:'방문자',title:'로그인만 한 사용자',body:'별도 가입 없이 작성'})).headers.get('location'), 'https://test.local/community?saved=1');
check((await data.getPosts('community',1)).total,2);
const communityPost=(await data.getPosts('community',1)).items[0];
check((await data.getCommunityPost(communityPost.id)).title,'로그인만 한 사용자');
const privatePost=(await data.getPosts('qna',1,'google:alice')).items[0];
check(await data.getCommunityPost(privatePost.id), null);
globalThis.testHeaders = new Headers({'oai-authenticated-user-id':'google:forged','oai-authenticated-user-email':'forged@test'});
check((await submit('qna',{title:'위조',body:'차단'})).status,401);
await signIn(null);
check((await submit('community',{author:'비회원',title:'익명 작성',body:'비회원 저장 확인'})).headers.get('location'),'https://test.local/community?saved=1');
check((await data.getPosts('community',1)).items[0].author,'비회원');
check((await submit('community',{author:'방문자',title:'타 사이트',body:'차단'},'https://other.test')).status,403);
check((await submit('community',{author:' '.repeat(2),title:'빈 이름',body:'내용'})).headers.get('location'),'https://test.local/community?error=invalid');
sqlite.close();
console.log(`${checks} server checks passed: anonymous guestbook, membership gate, Q&A isolation, SQL values, ordering and pagination.`);
