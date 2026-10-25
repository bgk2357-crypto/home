import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';

const root = process.cwd();
const php = process.env.PHP_BIN || path.join(root, '.sites-runtime/php74/php.exe');
const args = process.platform === 'win32' ? ['-d', `extension_dir=${path.dirname(php)}/ext`, '-d', 'extension=php_mbstring.dll', '-d', 'extension=php_pdo_sqlite.dll', '-d', 'extension=php_curl.dll'] : [];
const folder = path.join(root, '.sites-runtime/tests/webstation-' + randomUUID());
await mkdir(folder, { recursive: true });
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`, secret = randomBytes(32).toString('hex');
const configuration = { app_origin: origin, auth_secret: secret, data_dir: folder + '/data', google_client_id: 'fixture-client', google_client_secret: 'fixture-secret', naver_map_client_id: '', trusted_proxy_ips: ['127.0.0.1', '::1'] };
const configPath = path.join(folder, 'config.php'), serverRoot = path.join(root, 'outputs/synology-webstation/server');
await writeFile(configPath, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify(configuration)).toString('base64')}'), true);`);
const env = { ...process.env, ARGO_CONFIG_PATH: configPath, ARGO_SERVER_ROOT: serverRoot };
await writeFile(path.join(root, '.sites-runtime/tests/webstation-current.json'), JSON.stringify({ configPath, serverRoot, folder }));
function command(more) { const result = spawnSync(php, [...args, ...more], { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout; }
for (const name of (await readdir(serverRoot)).filter(name => name.endsWith('.php'))) command(['-l', path.join(serverRoot, name)]);
command(['-l', path.join(root, 'outputs/synology-webstation/public/index.php')]);
console.log(command(['tests/webstation-unit.php']).trim());
let child, logs = '', checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const route = (name, query = {}) => origin + '/index.php?' + new URLSearchParams({ route: name, ...query });
async function launch() {
  child = spawn(php, [...args, '-S', `127.0.0.1:${port}`, '-t', 'outputs/synology-webstation/public'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  for (let i = 0; i < 80; i++) { if (child.exitCode !== null) throw Error(logs); try { if ((await fetch(route('/api/health'))).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('PHP server not ready: ' + logs);
}
async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
function session(id, expired = false) {
  const payload = Buffer.from(JSON.stringify({ type: 'session', userId: 'google:' + id, email: id + '@example.test', displayName: '회원 ' + id, fullName: null, exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600) })).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}
let csrf, csrfCookie;
const cookies = id => [csrfCookie, id ? 'argo_session=' + session(id) : ''].filter(Boolean).join('; ');
async function page(name, id, extra = {}) { const r = await fetch(route('/api/page', { path: name, ...extra }), { headers: { Cookie: cookies(id) } }); eq(r.status, 200); return r.json(); }
async function post(action, values, id, headers = {}) { return fetch(route('/actions/' + action), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies(id), ...headers }, body: new URLSearchParams({ _csrf: csrf, ...values }), redirect: 'manual' }); }
try {
  await launch();
  let r = await fetch(route('/api/page', { path: '/' })); const context = await r.json(); csrf = context.csrf; csrfCookie = 'argo_csrf=' + csrf;
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i); checks++;
  eq(context.user, null); eq(context.googleReady, true); assert.ok(!JSON.stringify(context).includes(secret)); checks++;
  r = await fetch(route('/api/page', { path: '/' }), { headers: { 'X-Forwarded-Proto': 'https' } }); assert.match(r.headers.get('set-cookie'), /secure/i); checks++;
  r = await fetch(origin); eq(r.status, 200); assert.match(await r.text(), /assets\/index-/); checks++;
  for (const asset of ['/favicon.svg', '/ghs/GHS02.svg', '/templates/blank.hwpx', '/vendor/pdf.worker.min.mjs']) eq((await fetch(origin + asset)).status, 200);
  r = await post('guestbook', { author: '방문자', body: '한글 저장\n<script>문자열</script>' }); eq(r.status, 303); assert.match(r.headers.get('location'), /saved=1/); checks++;
  let data = await page('/guestbook'); eq(data.entries.total, 1); eq(data.entries.items[0].body, '한글 저장\n<script>문자열</script>');
  eq((await post('guestbook', { author: 'a', body: 'b' }, null, { Origin: 'https://evil.test' })).status, 403);
  eq((await post('guestbook', { author: 'a', body: 'b', _csrf: 'wrong' })).status, 403);
  r = await post('guestbook', { author: '한'.repeat(31), body: 'bad' }); assert.match(r.headers.get('location'), /error=invalid/); checks++;
  r = await post('guestbook', { author: 'a', body: 'x'.repeat(33000) }); assert.match(r.headers.get('location'), /error=invalid/); checks++;
  r = await post('guestbook', { author: ' ', body: 'bad' }); assert.match(r.headers.get('location'), /error=invalid/); checks++;
  r = await fetch(route('/actions/guestbook'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrfCookie }, body: new URLSearchParams({ _csrf: csrf, author: 'a', body: 'b' }).toString() + '&author=duplicate', redirect: 'manual' }); assert.match(r.headers.get('location'), /error=invalid/); checks++;
  eq((await post('join', { displayName: '회원', consent: 'yes' })).status, 401);
  eq((await post('qna', { title: '문의', body: '내용' })).status, 401);
  eq((await post('qna', { title: '문의', body: '내용' }, 'unregistered')).status, 403);
  r = await post('join', { displayName: '회원A' }, 'A'); assert.match(r.headers.get('location'), /error=invalid/); checks++;
  for (const id of ['A', 'B']) eq((await post('join', { displayName: '회원' + id,businessName:'테스트 사업장',businessSize:'20~49인',contactName:'담당자',jobTitle:'과장',phone:'010-0000-0000',consent: 'yes' }, id)).status, 303);
  data = await page('/members', 'A'); eq(data.member.displayName, '회원A');
  eq((await post('qna', { title: 'A의 비공개 문의', body: '개인 문의 본문' }, 'A')).status, 303);
  eq((await page('/qna', 'A')).posts.total, 1); eq((await page('/qna', 'B', { user_id: 'google:A' })).posts.total, 0); eq((await page('/qna')).posts.total, 0);
  eq((await post('community', { author: '위조명', title: '공개 게시글', body: '공개 본문' }, 'A')).status, 303);
  data = await page('/community'); eq(data.posts.total, 1); const postId = data.posts.items[0].id;
  eq((await page('/community', null, { post: postId })).selected.title, '공개 게시글');
  eq((await page('/community', null, { post: postId - 1 })).selected, null);
  r = await fetch(route('/api/page', { path: '/members' }), { headers: { Cookie: cookies('A').replace(session('A'), session('A', true)) } }); eq((await r.json()).user, null);
  r = await fetch(route('/api/page', { path: '/members' }), { headers: { Cookie: csrfCookie + '; argo_session=' + session('A') + 'tamper' } }); eq((await r.json()).user, null);
  r = await fetch(route('/auth/google', { return_to: '/qna' }), { redirect: 'manual' }); eq(r.status, 303); const google = new URL(r.headers.get('location')); eq(google.origin, 'https://accounts.google.com'); eq(google.searchParams.get('code_challenge_method'), 'S256'); eq(google.searchParams.get('redirect_uri'), origin + '/index.php?route=%2Fauth%2Fgoogle%2Fcallback');
  const flowCookie = r.headers.get('set-cookie').split(';')[0]; const flow = JSON.parse(Buffer.from(flowCookie.split('=')[1].split('.')[0], 'base64url').toString()); eq(flow.returnTo, '/qna');
  r = await fetch(route('/auth/google/callback', { state: 'wrong', code: 'bad' }), { headers: { Cookie: flowCookie }, redirect: 'manual' }); assert.match(r.headers.get('location'), /error=cancelled/); checks++;
  r = await fetch(route('/auth/logout', { return_to: '//evil.test' }), { headers: { Cookie: cookies('A') }, redirect: 'manual' }); eq(r.headers.get('location'), '/index.php?route=%2F'); assert.match(r.headers.get('set-cookie'), /argo_session=/); checks++;
  for (const kind of ['general', 'trends']) { r = await fetch(route('/api/news', { kind })); eq(r.status, 200); const news = await r.json(); assert.ok(news.articles.length > 0); checks++; eq(news.refreshMinutes, 30); }
  eq((await fetch(route('/api/news', { kind: 'bad' }))).status, 400);
  eq((await fetch(origin + '/index.php?route[]=bad')).status, 400);
  eq((await fetch(route('/auth/google'), { method: 'POST' })).status, 405);
  await stop(); await launch(); eq((await page('/guestbook')).entries.total, 1); eq((await page('/community')).posts.total, 1); eq((await page('/qna', 'A')).posts.total, 1);
  // Reproduce Synology TLS termination without forwarding headers: browser uses
  // the configured HTTPS hostname while PHP receives HTTP on a loopback host.
  await stop();
  const publicOrigin = 'https://homepage.example.test';
  await writeFile(configPath, `<?php return json_decode(base64_decode('${Buffer.from(JSON.stringify({ ...configuration, app_origin: publicOrigin })).toString('base64')}'), true);`);
  await launch();
  eq((await post('guestbook', { author: 'Proxy visitor', body: 'HTTPS guestbook' }, null, { Origin: publicOrigin })).status, 303);
  eq((await post('community', { author: 'Proxy visitor', title: 'HTTPS community', body: 'Saved through proxy' }, 'A', { Origin: publicOrigin })).status, 303);
  eq((await page('/guestbook')).entries.total, 2);
  eq((await page('/community')).posts.total, 2);
  eq((await post('guestbook', { author: 'a', body: 'b', _csrf: 'wrong' }, null, { Origin: publicOrigin })).status, 403);
  for (const hostile of ['https://evil.test', publicOrigin + '.evil.test', 'null', 'http://homepage.example.test']) {
    eq((await post('guestbook', { author: 'a', body: 'b' }, null, { Origin: hostile, 'X-Forwarded-Host': hostile.replace(/^https?:\/\//, ''), 'X-Forwarded-Proto': 'https' })).status, 403);
  }
  console.log(`${checks} PHP HTTP checks passed: database migrations/persistence, public boards, CSRF/validation, membership, private Q&A isolation, signed/expired sessions, OAuth redirects, news and assets.`);
} finally { await stop(); }
