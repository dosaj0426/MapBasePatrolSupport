import React, { useEffect, useState } from 'react';
import { api, jsonBody } from './api';
import type { SessionIdentity } from './accessClient';
// Capture once before loading external map scripts, then remove the secret from the address bar.
const entryToken = location.pathname==='/access' ? location.hash.slice(1) : '';
if (location.pathname==='/access') history.replaceState(null,'','/access');
let connection: Promise<SessionIdentity> | undefined;
export default function AccessGate({children}: React.PropsWithChildren) {
  const [identity,setIdentity]=useState<SessionIdentity|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    let disposed=false;
    connection ||= entryToken ? api<SessionIdentity>('/access/exchange',{method:'POST',body:jsonBody({token:entryToken})}) : api<SessionIdentity>('/session');
    connection.then(session=>{
      if(disposed)return;
      const path=location.pathname;
      if(path==='/access' || (session.role==='user' && (path==='/' || path==='/user'))) {
        location.replace(session.role==='admin'?'/admin':`/user/${session.officer_id}`); return;
      }
      if(session.role==='user' && path!==`/user/${session.officer_id}`) { setError('해당 화면의 접속 권한이 없습니다. 본인의 순찰자 화면으로 이동해 주세요.'); setIdentity(session); return; }
      setIdentity(session);
    }).catch(e=>{if(!disposed)setError(e.message);});
    const expired=()=>{setIdentity(null);setError('접속 권한이 만료·폐기되었습니다. 관리자에게 새 링크를 요청해 주세요.');};
    window.addEventListener('patrol-access-expired',expired);
    return()=>{disposed=true;window.removeEventListener('patrol-access-expired',expired);};
  },[]);
  if(error) return <main className="entry"><p className="eyebrow">SMART PATROL</p><h1>접속 권한 확인</h1><p role="alert">{error}</p>{identity?.role==='user' && <a href={`/user/${identity.officer_id}`}>내 순찰자 화면으로 이동 →</a>}<p>관리자는 서버에서 발급한 관리자 링크로, 순찰자는 관리자가 전달한 전용 링크로 접속해 주세요.</p><button onClick={()=>location.reload()}>다시 확인</button></main>;
  if(!identity)return <main className="entry"><h1>접속 권한을 확인하고 있습니다</h1><p role="status">잠시 기다려 주세요.</p></main>;
  return children;
}
