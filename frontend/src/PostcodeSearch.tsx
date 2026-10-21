import React, { useEffect, useRef, useState } from 'react';

export default function PostcodeSearch({ onComplete, onClose }: { onComplete: (address: {address: string; postal_code: string}) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), frame = useRef<HTMLIFrameElement>(null), callbacks = useRef({ onComplete, onClose });
  callbacks.current = { onComplete, onClose };
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const fail = () => { setLoading(false); setError('주소 검색 서비스에 연결하지 못했습니다. 닫은 뒤 도로명 주소를 직접 검색해 주세요.'); };
    const timer = setTimeout(fail, 15000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === 'postcode-ready') { clearTimeout(timer); setLoading(false); }
      if (data?.type === 'postcode-error') { clearTimeout(timer); fail(); }
      if (data?.type === 'postcode-selected' && typeof data.address === 'string' && /^\d{5}$/.test(data.postal_code)) {
        clearTimeout(timer); callbacks.current.onComplete({ address: data.address, postal_code: data.postal_code });
      }
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); element.close(); };
  }, []);
  return <dialog className="postcode-dialog" ref={dialog} aria-labelledby="postcode-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id="postcode-title">우편번호·주소 찾기</h2><button type="button" onClick={onClose} aria-label="주소 검색 닫기">닫기</button></header>
    {loading && <p role="status">주소 검색을 불러오는 중…</p>}
    {error && <p role="alert">{error}</p>}
    <iframe ref={frame} src="/postcode.html" title="우편번호 주소 검색" className="postcode-host" style={{border:0,display:'block'}} />
  </dialog>;
}
