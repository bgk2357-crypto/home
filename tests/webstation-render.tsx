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
const paths = new Set(['/', '/login', '/join', '/members', '/qna', '/guestbook', '/community', '/privacy', '/admin/members', '/services', '/workspace/msds', '/workspace/system', '/workspace/risk', '/workspace/ergonomics', ...navigation.flatMap(item => item.children.map(([, path]) => path))]);
for (const path of paths) {
  const page = path === '/' ? await Home() : path === '/login' ? await Login({ searchParams: Promise.resolve({}) }) : await ContentPage({ params: Promise.resolve({ slug: path.slice(1).split('/') }), searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(page);
  if(path.startsWith('/workspace/')) assert.ok(html.includes('정회원 전용 업무 대시보드'),path); else assert.ok(html.includes('site-header') && html.includes('site-footer') && html.includes('main-content'), path);
  assert.ok(!html.includes('[object Promise]'), path); checks++;
  if (path === '/resources/msds') { assert.ok(html.includes('일반회원부터') && html.includes('맛보기')); checks++; }
  if (path === '/news/statistics') { assert.ok(html.includes('2025')); checks++; }
}
setContext({ ...base, entries: { items: [{ id: 1, author: '방문자', body: '<script>alert(1)</script>', createdAt: '2026-10-25T00:00:00Z' }], total: 1, pages: 1, current: 1 } });
let html = renderToStaticMarkup(await ContentPage({ params: Promise.resolve({ slug: ['guestbook'] }), searchParams: Promise.resolve({ saved: '1' }) }));
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !html.includes('<script>alert(1)</script>')); checks++;
setContext({ ...base, user: { userId: 'google:A', email: 'a@example.test', displayName: '회원 A', fullName: null }, member: { userId: 'google:A', role:'general', businessName:'테스트 사업장',businessSize:'20~49인',contactName:'테스트 담당자',jobTitle:'과장',phone:'010-0000-0000',displayName: '가입한회원', createdAt: '2026-10-25T00:00:00Z' }, posts: { items: [{ id: 1, author: '가입한회원', body: '비공개 문의', title: '문의 제목', kind: 'qna', userId: 'google:A', createdAt: '2026-10-25T00:00:00Z' }], total: 1, pages: 1, current: 1 } });
for (const path of ['members', 'qna', 'join']) {
  html = renderToStaticMarkup(await ContentPage({ params: Promise.resolve({ slug: [path] }), searchParams: Promise.resolve({}) }));
  assert.ok(html.includes('가입한회원') && html.includes('로그아웃')); checks++;
  if (path === 'qna') { assert.ok(html.includes('비공개 문의') && html.includes('action="/actions/qna"')); checks++; }
}
assert.equal(routeUrl('/community?post=1#write-post'), '/index.php?route=%2Fcommunity&post=1#write-post'); checks++;
const companyMenu=navigation.find(n=>n.label==='회사소개')!;
assert.equal(companyMenu.children[companyMenu.children.findIndex(([label])=>label==='연혁')+1][0],'주요실적');checks++;
assert.ok(!navigation.find(n=>n.label==='사업범위 소개')!.children.some(([label])=>label==='주요실적'));checks++;
assert.equal(navigation.find(n=>n.label==='회원 전용 서비스')!.href,'/services');checks++;
setContext({...base,user:{userId:'google:paid',email:'paid@example.test',displayName:'정회원',fullName:null,role:'paid'},member:{userId:'google:paid',displayName:'정회원',createdAt:'2026-10-26T00:00:00Z',email:'paid@example.test',role:'paid',businessName:'테스트사업장',businessSize:'20~49인',contactName:'담당자',jobTitle:'과장',phone:'010-0000-0000',profileCompletedAt:'2026-10-26T00:00:00Z',updatedAt:null,version:1}});
for(const id of ['system','risk','ergonomics','msds']){html=renderToStaticMarkup(await ContentPage({params:Promise.resolve({slug:['workspace',id]}),searchParams:Promise.resolve({})}));assert.ok(html.includes('wd-sidebar')&&html.includes('업무 메뉴')&&!html.includes('정회원 전용 업무 대시보드입니다'));checks++;}
html=renderToStaticMarkup(await ContentPage({params:Promise.resolve({slug:['services']}),searchParams:Promise.resolve({})}));assert.equal((html.match(/대시보드 새 창으로 열기/g)||[]).length,4);assert.equal((html.match(/target="_blank"/g)||[]).length,4);checks+=2;
console.log(`${checks} adapted React render checks passed: every existing route, shared MSDS/statistics screens, authenticated views, XSS escaping and query links.`);
