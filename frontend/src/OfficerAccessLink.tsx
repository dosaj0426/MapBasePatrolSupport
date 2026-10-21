import { useEffect, useState } from 'react';
import { api, jsonBody } from './api';
type Grant = {id:number; expires_at:string; active:boolean};
type Issued = {id:number; expires_at:string; url:string};
export default function OfficerAccessLink({officerId}:{officerId:number}) {
  const [grants,setGrants]=useState<Grant[]>([]),[issued,setIssued]=useState<Issued|null>(null),[days,setDays]=useState(30),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function refresh(){setGrants(await api<Grant[]>(`/officers/${officerId}/access-links`));}
  useEffect(()=>{refresh().catch(e=>setMessage(e.message));},[officerId]);
  const active=grants.find(g=>g.active);
  async function issue(){
    if(active && !window.confirm('새 링크를 발급하면 기존 링크와 해당 링크로 접속한 세션이 중단됩니다. 재발급할까요?'))return;
    setBusy(true);setMessage('');
    try{setIssued(await api<Issued>(`/officers/${officerId}/access-links`,{method:'POST',body:jsonBody({days})}));await refresh();setMessage('링크를 복사해 해당 순찰자에게 전달해 주세요.');}catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  async function revoke(){
    if(!window.confirm('이 순찰자의 링크와 접속 세션을 폐기할까요? 순찰 기록은 유지됩니다.'))return;
    setBusy(true);
    try{await api(`/officers/${officerId}/access-links`,{method:'DELETE'});setIssued(null);await refresh();setMessage('링크와 접속 권한을 폐기했습니다.');}catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  async function copy(){if(!issued)return;try{await navigator.clipboard.writeText(issued.url);setMessage('접속 링크를 복사했습니다.');}catch{setMessage('아래 링크를 선택해 직접 복사해 주세요.');}}
  return <section className="officer-access" aria-label="전용 접속 링크"><strong>전용 접속 링크</strong><small>{active?`사용 가능 · ${new Date(active.expires_at).toLocaleDateString('ko-KR')}까지`:'발급된 유효 링크 없음'}</small><label>링크 유효기간<select value={days} disabled={busy} onChange={e=>setDays(Number(e.target.value))}><option value={1}>1일</option><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label><div><button disabled={busy} onClick={issue}>{active?'링크 재발급':'링크 발급'}</button>{active && <button disabled={busy} onClick={revoke}>링크 폐기</button>}</div>{issued && <><input aria-label="발급된 비밀 접속 링크" readOnly value={issued.url} onFocus={e=>e.currentTarget.select()}/><button onClick={copy}>링크 복사</button><small>이 링크를 가진 사람은 해당 순찰자 권한을 사용할 수 있습니다. 링크는 이번 화면에서만 표시합니다.</small></>}{message && <p role="status">{message}</p>}</section>;
}
