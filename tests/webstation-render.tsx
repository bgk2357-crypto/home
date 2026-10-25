import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setContext, routeUrl } from '../nas-webstation/frontend/context';
import Home from '../app/page';
import ContentPage from '../app/[...slug]/page';
import Login from '../app/login/page';
import { navigation } from '../app/content';

globalThis.location = { origin: 'https://ssk2357.synology.me' } as Location;
const empty = { items: [], total: 0, pages: 1, current: 1 };
const base = { user: null, member: null, entries: empty, posts: empty, selected: null, googleReady: true, mapKey: '', csrf: 'test' };
setContext(base);
let checks = 0;
const paths = new Set(['/', '/login', '/join', '/members', '/qna', '/guestbook', '/community', '/privacy', ...navigation.flatMap(item => item.children.map(([, path]) => path))]);
for (const path of paths) {
  const page = path === '/' ? await Home() : path === '/login' ? await Login({ searchParams: Promise.resolve({}) }) : await ContentPage({ params: Promise.resolve({ slug: path.slice(1).split('/') }), searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(page);
  assert.ok(html.includes('site-header') && html.includes('site-footer') && html.includes('main-content'), path);
  assert.ok(!html.includes('[object Promise]'), path); checks++;
  if (path === '/resources/msds') { assert.ok(html.includes('msds-files') && html.includes('MSDS')); checks++; }
  if (path === '/news/statistics') { assert.ok(html.includes('2025')); checks++; }
}
setContext({ ...base, entries: { items: [{ id: 1, author: '방문자', body: '<script>alert(1)</script>', createdAt: '2026-10-25T00:00:00Z' }], total: 1, pages: 1, current: 1 } });
let html = renderToStaticMarkup(await ContentPage({ params: Promise.resolve({ slug: ['guestbook'] }), searchParams: Promise.resolve({ saved: '1' }) }));
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !html.includes('<script>alert(1)</script>')); checks++;
setContext({ ...base, user: { userId: 'google:A', email: 'a@example.test', displayName: '회원 A', fullName: null }, member: { userId: 'google:A', displayName: '가입한회원', createdAt: '2026-10-25T00:00:00Z' }, posts: { items: [{ id: 1, author: '가입한회원', body: '비공개 문의', title: '문의 제목', kind: 'qna', userId: 'google:A', createdAt: '2026-10-25T00:00:00Z' }], total: 1, pages: 1, current: 1 } });
for (const path of ['members', 'qna', 'join']) {
  html = renderToStaticMarkup(await ContentPage({ params: Promise.resolve({ slug: [path] }), searchParams: Promise.resolve({}) }));
  assert.ok(html.includes('가입한회원') && html.includes('로그아웃')); checks++;
  if (path === 'qna') { assert.ok(html.includes('비공개 문의') && html.includes('action="/actions/qna"')); checks++; }
}
assert.equal(routeUrl('/community?post=1#write-post'), '/index.php?route=%2Fcommunity&post=1#write-post'); checks++;
console.log(`${checks} adapted React render checks passed: every existing route, shared MSDS/statistics screens, authenticated views, XSS escaping and query links.`);
