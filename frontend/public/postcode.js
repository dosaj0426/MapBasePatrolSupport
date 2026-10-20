const send = (type, data) => parent.postMessage({ type, ...data }, location.origin);
const script = document.createElement('script');
script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
script.onerror = () => send('postcode-error');
script.onload = () => {
  const Postcode = window.kakao?.Postcode || window.daum?.Postcode;
  if (!Postcode) { send('postcode-error'); return; }
  new Postcode({ width: '100%', height: '100%',
    onresize: () => send('postcode-ready'),
    oncomplete: data => send('postcode-selected', { address: data.roadAddress || data.jibunAddress, postal_code: data.zonecode })
  }).embed(document.getElementById('search'));
};
document.head.appendChild(script);
