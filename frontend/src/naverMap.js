let sdkPromise;
export function loadMap(key) {
  if (sdkPromise) return sdkPromise;
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps);
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = message => { clearTimeout(timer); sdkPromise = undefined; script.remove(); reject(new Error(message)); };
    const timer = setTimeout(() => fail('지도 로딩 시간이 초과되었습니다. 네트워크 또는 등록 URL을 확인하고 다시 시도해 주세요.'), 15000);
    // SDK 콜백이 전역 Map 공개보다 먼저 호출되는 버전도 있어 다음 작업에서 확인한다.
    const ready = () => { if (window.naver?.maps?.Map) { clearTimeout(timer); resolve(window.naver.maps); } };
    window.__patrolMapReady = () => setTimeout(ready, 0);
    script.onload = ready;
    window.navermap_authFailure = () => fail('지도 인증 실패: API 키와 등록 URL을 확인해 주세요.');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}&submodules=geocoder&callback=__patrolMapReady`;
    script.onerror = () => fail('네이버 지도에 연결할 수 없습니다.');
    document.head.appendChild(script);
  });
  return sdkPromise;
}


