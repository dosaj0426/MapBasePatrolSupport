export async function prepareMapTransport() {
  if (!import.meta.env.DEV || location.protocol !== 'http:') return;
  if (!('serviceWorker' in navigator)) throw new Error('지도 HTTPS 연결을 준비할 수 없습니다. localhost 또는 127.0.0.1로 접속해 주세요.');
  await navigator.serviceWorker.register('/map-transport.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', ready); reject(new Error('지도 연결 준비가 지연됩니다. 새로고침해 주세요.')); }, 5000);
    function ready() { clearTimeout(timer); resolve(); }
    navigator.serviceWorker.addEventListener('controllerchange', ready, { once: true });
  });
}
