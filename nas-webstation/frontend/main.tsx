import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../../app/page';
import ContentPage from '../../app/[...slug]/page';
import Login from '../../app/login/page';
import { Header, Footer } from '../../app/components';
import { context, routeUrl, setContext } from './context';
import '../../app/globals.css';

// Query routing runs on both Apache and nginx without rewrite modules.
// Translate internal navigation and forms while retaining normal browser history,
// full page navigation, new-tab links, and server-side POST/redirect semantics.
function translateLinks() {
  for (const element of document.querySelectorAll<HTMLAnchorElement | HTMLFormElement>('a[href], form[action]')) {
    const attr = element.tagName === 'FORM' ? 'action' : 'href';
    const value = element.getAttribute(attr) || '';
    if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/index.php') && !/\.(svg|hwpx|pdf|mjs)(?:[?#]|$)/i.test(value)) element.setAttribute(attr, routeUrl(value));
    if (element.tagName === 'FORM' && element.getAttribute('method')?.toLowerCase() === 'post' && context && !element.querySelector('input[name="_csrf"]')) {
      const input = document.createElement('input'); input.type = 'hidden'; input.name = '_csrf'; input.value = context.csrf; element.append(input);
    }
  }
}
const observer = new MutationObserver(translateLinks);
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'action'] });
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => nativeFetch(typeof input === 'string' && input.startsWith('/api/') ? routeUrl(input) : input, init);

async function start() {
  const params = new URLSearchParams(location.search);
  const path = params.get('route') || (location.pathname === '/index.php' ? '/' : location.pathname);
  const query = Object.fromEntries([...params].filter(([key]) => key !== 'route'));
  const endpoint = new URL(routeUrl('/api/page'), location.origin);
  endpoint.searchParams.set('path', path);
  endpoint.searchParams.set('page', params.get('page') || '1');
  endpoint.searchParams.set('post', params.get('post') || '');
  const response = await nativeFetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('홈페이지 데이터에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
  setContext(await response.json());
  let page;
  try {
    page = path === '/' ? await Home() : path === '/login' ? await Login({ searchParams: Promise.resolve(query) }) : await ContentPage({ params: Promise.resolve({ slug: path.slice(1).split('/') }), searchParams: Promise.resolve(query) });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'not-found') throw error;
    page = <><Header/><main className="page-main container" id="main-content"><h1>페이지를 찾을 수 없습니다</h1><a href="/">홈으로 이동 →</a></main><Footer/></>;
  }
  createRoot(document.getElementById('root')!).render(<><a className="skip-link" href="#main-content">본문으로 바로가기</a>{page}</>);
}
start().catch(error => {
  const container = document.getElementById('root')!;
  const message = document.createElement('p'); message.className = 'notice error';
  message.textContent = error instanceof Error ? error.message : '홈페이지를 불러오지 못했습니다.';
  container.replaceChildren(message);
});
