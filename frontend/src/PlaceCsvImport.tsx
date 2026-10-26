import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Place } from './types';
type Preview = {id:string; total:number; rows:{line:number; data:Omit<Place,'id'|'revision'>}[]; errors:{line:number; name:string; message:string}[]; expires_at:string};
export default function PlaceCsvImport({onBack,onImported}:{onBack:()=>void;onImported:(count:number)=>void}) {
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function inspect(){
    if(!file)return;
    setBusy(true);setMessage('주소를 변환하고 파일을 검사하고 있습니다.');setPreview(null);
    const request=new AbortController();controller.current=request;
    try{const data=new FormData();data.append('file',file);const result=await api<Preview>('/places/import/preview',{method:'POST',body:data,signal:request.signal});setPreview(result);setMessage(result.errors.length?'오류가 있습니다. CSV 수정 후 다시 검사해 주세요. 아직 등록되지 않았습니다.':'검사가 완료되었습니다. 아래 내용을 확인한 후 일괄 등록해 주세요.');}
    catch(e){if(!request.signal.aborted)setMessage(e.message);}finally{if(!request.signal.aborted)setBusy(false);}
  }
  async function commit(){
    if(!preview || preview.errors.length || busy)return;
    setBusy(true);setMessage('지점을 등록하고 있습니다.');
    try{const result=await api<{count:number;ids:number[]}>(`/places/import/${preview.id}/commit`,{method:'POST'});onImported(result.count);}
    catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  return <>
    <button className="history-back" disabled={busy} onClick={onBack}>← 지점 목록으로</button>
    <div className="admin-section-title"><div><p>IMPORT LOCATIONS</p><h1>위치 파일 추가</h1></div></div>
    <p className="admin-hint">CSV의 도로명 주소를 지도 좌표로 변환해 한 번에 등록합니다. 최대 50개·1MB, UTF-8 또는 CP949를 지원합니다.</p>
    <div className="csv-downloads"><a href="/templates/위치_일괄등록_양식.csv" download>빈 양식 다운로드 ↓</a><a href="/templates/위치_일괄등록_테스트.csv" download>테스트 CSV 다운로드 ↓</a></div>
    <details className="csv-format"><summary>CSV 작성 방법</summary><p>필수: 지점명, 분류, 도로명주소</p><p>선택: 우편번호, 상세주소, 강화구역, 반지름(m), 알림타입, 음성안내</p><p>강화구역: Y/N (기본 N)<br/>반지름: 5~10000m (기본 50)<br/>알림타입: info/warning/danger/emergency (기본 warning)</p><p>분류는 지점 분류 목록의 이름과 정확히 일치해야 하며 아이콘은 자동 지정됩니다. 기존 CSV의 완충배수는 무시하고 10m 고정 완충 거리를 적용합니다. 우편번호는 5자리 문자열로 작성하세요. 쉼표가 들어간 값은 큰따옴표로 감싸 주세요.</p><p>테스트 파일은 실제 공공시설 주소를 사용한 가상 지점 3개이며 강화구역은 모두 N입니다. 업로드만으로 저장되지 않습니다.</p></details>
    <label className="admin-search-label">CSV 파일<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setPreview(null);setMessage('');}}/></label>
    <button className="admin-secondary" disabled={!file || busy} onClick={inspect}>{busy?'처리 중…':'파일 검사 · 미리보기'}</button>
    {message && <p className="admin-message" role="status">{message}</p>}
    {preview && <>
      <p className="place-record-count">전체 {preview.total}개 · 정상 {preview.rows.length}개 · 오류 {preview.errors.length}개</p>
      {preview.errors.map(error=><article className="csv-row-error" key={error.line}><strong>{error.line}행 · {error.name || '이름 없음'}</strong><p>{error.message}</p></article>)}
      {preview.rows.map(row=><article className="csv-preview-row" key={row.line}><strong>{row.line}행 · {row.data.name}</strong><p>{row.data.address}</p><small>{row.data.category} · {row.data.enhanced?'강화구역':'일반 지점'} · 우편번호 {row.data.postal_code || '없음'}</small></article>)}
      <p className="admin-hint">오류가 하나라도 있으면 전체 등록을 막습니다. 검사 후 1시간 이내에 등록해 주세요. 같은 미리보기의 재요청은 중복 등록되지 않습니다.</p>
      <button className="admin-primary csv-commit" disabled={busy || preview.errors.length>0 || !preview.rows.length} onClick={commit}>{preview.rows.length}개 지점 일괄 등록</button>
    </>}
  </>;
}
