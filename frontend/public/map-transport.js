// 로컬 HTTP 개발에서만 사용한다. SDK는 HTTPS 페이지에서 이 CDN을 직접 선택한다.
// 타일을 저장하거나 변형하지 않고 공식 HTTPS 엔드포인트로 요청만 전달한다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.protocol !== 'http:') return;
  if (url.hostname === 'oapi.map.naver.com' && url.pathname.startsWith('/v3/auth')) {
    url.protocol = 'https:';
  } else if (url.hostname === 'nrbe.map.naver.net' && url.pathname.startsWith('/styles/')) {
    url.protocol = 'https:';
    url.hostname = 'nrbe.pstatic.net';
  } else if (url.hostname === 'nrb.map.naver.net' && url.pathname.startsWith('/styles/')) {
    url.protocol = 'https:';
    url.hostname = 'map.pstatic.net';
    url.pathname = '/nrb' + url.pathname;
  } else if (url.hostname === 'static.naver.net' && url.pathname.startsWith('/maps/')) {
    url.protocol = 'https:';
    url.hostname = 'ssl.pstatic.net';
    url.pathname = '/static' + url.pathname;
  } else return;
  event.respondWith(fetch(url.href, {
    mode: request.mode === 'navigate' ? 'cors' : request.mode,
    credentials: 'omit',
    redirect: 'follow',
  }));
});
