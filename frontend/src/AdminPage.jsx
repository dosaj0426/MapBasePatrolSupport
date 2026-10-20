import React, { useCallback, useEffect, useState } from 'react';
import ManagedMap from './ManagedMap.jsx';
import { api, jsonBody } from './api.js';
import { findAddress } from './addressSearch.js';
import PostcodeSearch from './PostcodeSearch.jsx';
import { NOTIFICATION_TYPES } from './notificationTypes.js';
import './admin.css';

const emptyPlace = () => ({ name: '', category: '여성 1인 사업장', address: '', postal_code: '', detail: '', icon_id: '', enhanced: false, radius: 50, multiplier: 1.5, message: '', alert_type: 'warning' });
const duration = value => `${Math.floor((value || 0)/60)}분 ${Math.floor((value || 0)%60)}초`;
const formatTime = value => value ? new Date(value).toLocaleString('ko-KR') : '수신 대기';

export default function AdminPage() {
  const [tab, setTab] = useState('places'), [places, setPlaces] = useState([]), [icons, setIcons] = useState([]), [officers, setOfficers] = useState([]);
  const [form, setForm] = useState(emptyPlace), [editId, setEditId] = useState(null), [selected, setSelected] = useState(null);
  const [query, setQuery] = useState(''), [candidates, setCandidates] = useState([]), [iconQuery, setIconQuery] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [officerName, setOfficerName] = useState('');
  const [postcodeOpen, setPostcodeOpen] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false), [speechPreview, setSpeechPreview] = useState(null);
  const speechText = form.message.trim() || `${form.name.trim()} 범죄예방 강화구역입니다. 주변을 확인해 주세요.`;
  async function previewSpeech() {
    setSpeechBusy(true); setMessage('안내 음성을 생성하고 있습니다. 처음 생성할 때는 시간이 걸릴 수 있습니다.');
    try { const result = await api('/tts/synthesize', { method: 'POST', body: jsonBody({ text: speechText }) }); setSpeechPreview({ text: speechText, url: result.url }); setMessage('음성 생성 완료. 재생 버튼으로 미리 들어보세요.'); }
    catch(e) { setMessage(e.message); } finally { setSpeechBusy(false); }
  }
  const [iconName, setIconName] = useState(''), [iconFile, setIconFile] = useState(null), [uploadKey, setUploadKey] = useState(0);
  const [patrols, setPatrols] = useState([]), [filterOfficer, setFilterOfficer] = useState(''), [history, setHistory] = useState(null);
  const refresh = useCallback(async () => {
    const [p, i] = await Promise.all([api('/places'), api('/icons')]);
    setPlaces(p); setIcons(i);
  }, []);
  useEffect(() => { let disposed = false; async function update() { try { if (!disposed) await refresh(); } catch(e) { if (!disposed) setMessage(e.message); } } update(); const timer = setInterval(update, 5000); return () => { disposed = true; clearInterval(timer); }; }, [refresh]);
  useEffect(() => {
    let disposed = false;
    const stream = new EventSource('/api/live/officers');
    stream.onmessage = event => { try { const data = JSON.parse(event.data); if (!disposed) setOfficers(data); } catch { /* 다음 갱신에서 복구 */ } };
    async function fallback() { if (stream.readyState !== EventSource.OPEN) try { const data = await api('/officers'); if (!disposed) setOfficers(data); } catch { /* 연결 자동 재시도 */ } }
    fallback(); const timer = setInterval(fallback, 1000);
    return () => { disposed = true; stream.close(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (tab !== 'history') return;
    let disposed = false;
    async function update() { try { const data = await api('/patrols' + (filterOfficer ? '?officer_id=' + filterOfficer : '')); if (!disposed) setPatrols(data); } catch(e) { if (!disposed) setMessage(e.message); } }
    update(); const timer = setInterval(update, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [tab, filterOfficer]);
  const historyId = history?.id;
  useEffect(() => {
    if (tab !== 'history' || !historyId) return;
    let disposed = false;
    async function update() {
      try { const detail = await api(`/patrols/${historyId}`); if (!disposed) setHistory(detail); }
      catch(e) { if (!disposed) setMessage(e.message); }
    }
    const timer = setInterval(update, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [tab, historyId]);
  const updateForm = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  function editPlace(place) { setTab('places'); setForm({ ...place, icon_id: place.icon_id ?? '' }); setEditId(place.id); setSelected(place); setQuery(place.address); setCandidates([]); setMessage(''); }
  function clearForm() { setForm(emptyPlace()); setEditId(null); setQuery(''); setCandidates([]); setSelected(null); }
  async function searchAddress(address = query, postalCode = '') {
    setBusy(true); setMessage(''); setCandidates([]);
    try {
      const results = (await findAddress(address)).map(r => ({ ...r, postal_code: r.postal_code || postalCode }));
      if (results.length === 1) {
        chooseAddress(results[0]);
        setMessage('주소 위치를 확인했습니다. 지점 이름 등 나머지 정보를 입력한 뒤 등록해 주세요.');
      } else {
        setCandidates(results);
        setMessage(results.length ? '주소가 여러 개 검색되었습니다. 아래에서 등록할 주소를 선택해 주세요.' : '검색 결과가 없습니다. 도로명과 건물 번호를 입력해 주세요.');
      }
    }
    catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  function chooseAddress(result) { setForm(f => ({ ...f, ...result })); setSelected(result); setCandidates([]); setQuery(result.address); }
  async function savePlace(event) {
    event.preventDefault(); if (!Number.isFinite(form.lat) || !Number.isFinite(form.lng)) { setMessage('주소 검색 결과를 선택해 위치를 확인해 주세요.'); return; }
    setBusy(true); setMessage('');
    try {
      const payload = { ...form, icon_id: form.icon_id ? Number(form.icon_id) : null, radius: Number(form.radius), multiplier: Number(form.multiplier) };
      const result = await api(editId ? `/places/${editId}` : '/places', { method: editId ? 'PUT' : 'POST', body: jsonBody(payload) });
      await refresh(); clearForm(); setSelected(result); setMessage('지점을 저장했습니다. 순찰자 화면에도 반영됩니다.');
    } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function deletePlace(place) {
    if (!window.confirm(`${place.name} 지점을 삭제할까요?`)) return;
    try { await api(`/places/${place.id}`, { method: 'DELETE' }); if (editId === place.id) clearForm(); await refresh(); setMessage('지점을 삭제했습니다.'); } catch(e) { setMessage(e.message); }
  }
  async function createOfficer(event) {
    event.preventDefault(); setBusy(true);
    try { const item = await api('/officers', { method: 'POST', body: jsonBody({ name: officerName }) }); setOfficerName(''); await refresh(); setMessage(`${item.name} 생성 완료 · ${item.url}`); } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function renameOfficer(event, officer) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api(`/officers/${officer.id}`, { method: 'PATCH', body: jsonBody({ name: data.get('name') }) }); await refresh(); setMessage('순찰자 이름을 변경했습니다.'); } catch(e) { setMessage(e.message); }
  }
  async function uploadIcon(event) {
    event.preventDefault(); if (!iconFile) return;
    setBusy(true); const data = new FormData(); data.append('name', iconName); data.append('file', iconFile);
    try { await api('/icons', { method: 'POST', body: data }); await refresh(); setIconName(''); setIconFile(null); setUploadKey(k => k+1); setMessage('아이콘을 서버에 등록했습니다.'); } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }

  return <div className="admin-workspace">
    <header className="admin-topbar"><div><a href="/" className="admin-brand">SMART PATROL</a><span>관리자 워크스페이스</span></div><a href="/user">순찰자 선택 ↗</a></header>
    <div className="admin-body"><section className="admin-editor">
      <nav className="admin-tabs" aria-label="관리자 메뉴">{[['places','지점 관리'],['icons','아이콘'],['officers','순찰자'],['history','순찰 기록']].map(([id,label]) => <button key={id} className={tab===id?'selected':''} onClick={()=>{setTab(id);setHistory(null);setMessage('');}}>{label}</button>)}</nav>
      {message && <p className="admin-message" role="status">{message}</p>}
      <div className="admin-scroll">
        {tab === 'places' && <>
          <div className="admin-section-title"><div><p>MAP LOCATIONS</p><h1>{editId ? '지점 수정' : '새 지점 등록'}</h1></div>{editId && <button onClick={clearForm}>새로 등록</button>}</div>
          <form onSubmit={savePlace} className="admin-form">
            <label>지점 이름<input required maxLength={100} value={form.name} onChange={e=>updateForm('name',e.target.value)} placeholder="예: ○○ 사업장" /></label>
            <label>분류<input required list="place-categories" maxLength={80} value={form.category} onChange={e=>updateForm('category',e.target.value)} /></label><datalist id="place-categories"><option>여성 1인 사업장</option><option>범죄자 거주지</option><option>여성안심귀갓길</option><option>CCTV</option><option>시설 점검</option><option>기타</option></datalist>
            <label>도로명 주소 검색<div className="admin-input-row"><input value={query} onChange={e=>{setQuery(e.target.value);setForm(f=>({...f,address:'',lat:undefined,lng:undefined}));}} placeholder="도로명 + 건물 번호" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(query.trim().length>=3 && !busy)searchAddress();}}} /><button type="button" disabled={busy || query.length<3} onClick={()=>searchAddress()}>검색</button></div></label>
            <button className="admin-secondary" type="button" disabled={busy} onClick={()=>setPostcodeOpen(true)}>우편번호·주소 찾기</button>
            {postcodeOpen && <PostcodeSearch onClose={()=>setPostcodeOpen(false)} onComplete={result=>{setPostcodeOpen(false);setQuery(result.address);setForm(f=>({...f,address:result.address,postal_code:result.postal_code,lat:undefined,lng:undefined}));searchAddress(result.address,result.postal_code);}} />}
            {!!candidates.length && <div className="address-candidates">{candidates.map((c,i)=><button type="button" key={i} onClick={()=>chooseAddress(c)}><strong>{c.address}</strong><small>{c.postal_code || '우편번호 없음'} · 선택하여 지도 확인</small></button>)}</div>}
            {form.address && <p className="admin-address-selected">{Number.isFinite(form.lat) && Number.isFinite(form.lng) ? '✓' : '…'} {form.address}<small>우편번호 {form.postal_code || '미제공'} · {Number.isFinite(form.lat) && Number.isFinite(form.lng) ? '지도 위치 확인 완료' : '좌표 변환이 필요합니다. 주소 검색을 완료해 주세요.'}</small></p>}
            <label>상세 주소<input maxLength={200} value={form.detail} onChange={e=>updateForm('detail',e.target.value)} placeholder="동·층·호수 등" /></label>
            <label>아이콘 이름 검색<input value={iconQuery} onChange={e=>setIconQuery(e.target.value)} placeholder="아이콘 검색" /></label>
            <div className="icon-picker"><button type="button" className={!form.icon_id?'selected':''} onClick={()=>updateForm('icon_id','')}>⌖ 기본</button>{icons.filter(i=>i.name.toLowerCase().includes(iconQuery.toLowerCase())).map(icon=><button key={icon.id} type="button" className={Number(form.icon_id)===icon.id?'selected':''} onClick={()=>updateForm('icon_id',icon.id)}><img src={icon.url} alt=""/>{icon.name}</button>)}</div>
            <fieldset className="enhanced-settings"><label className="admin-check"><input type="checkbox" checked={form.enhanced} onChange={e=>updateForm('enhanced',e.target.checked)} />범죄예방 강화구역</label>{form.enhanced && <>
              <div className="admin-two-cols"><label>진입 반지름 (m)<input required type="number" min={5} max={10000} value={form.radius} onChange={e=>updateForm('radius',e.target.value)} /></label><label>외곽 범위 배수<input required type="number" min={1.1} max={10} step={.1} value={form.multiplier} onChange={e=>updateForm('multiplier',e.target.value)} /></label></div>
              <small>내부 {form.radius}m 진입 시 안내 · 외곽 {Math.round(form.radius*form.multiplier)}m 이탈 후 재알림</small>
              <label>알림 타입<select value={form.alert_type} onChange={e=>updateForm('alert_type',e.target.value)}>{Object.entries(NOTIFICATION_TYPES).map(([id,type])=><option key={id} value={id}>{type.label}</option>)}</select></label>
              <label>음성 안내 문구<textarea maxLength={500} value={form.message} onChange={e=>updateForm('message',e.target.value)} placeholder="비워두면 지점 이름을 포함한 기본 안내" /></label>
              <small>로컬 한국어 AI 음성 · Sohee. 저장 시 안내 음성을 미리 생성하며 같은 문구는 재사용합니다.</small>
              <button type="button" className="admin-secondary" disabled={speechBusy || !form.name.trim()} onClick={previewSpeech}>{speechBusy?'음성 생성 중…':'안내 음성 생성 · 미리듣기'}</button>
              {speechPreview?.text === speechText && <audio controls src={speechPreview.url} style={{width:'100%'}} aria-label="강화구역 안내 음성 미리듣기"/>}
            </>}</fieldset>
            <button className="admin-primary" disabled={busy} type="submit">{busy?'처리 중…':editId?'지점 수정 저장':'지점 등록'}</button>
          </form>
          <h2 className="admin-list-title">등록 지점 <span>{places.length}</span></h2>{!places.length && <p className="admin-empty">등록된 지점이 없습니다.</p>}{places.map(p=><article className="admin-list-card" key={p.id}><button className="admin-record-link" onClick={()=>editPlace(p)}><strong>{p.name}</strong><span>{p.category}{p.enhanced?' · 강화구역':''}</span><small>{p.address}</small></button><button className="admin-danger" onClick={()=>deletePlace(p)}>삭제</button></article>)}
        </>}
        {tab === 'icons' && <><div className="admin-section-title"><div><p>ICON LIBRARY</p><h1>아이콘 관리</h1></div></div><form className="admin-form" onSubmit={uploadIcon}><label>아이콘 이름<input required maxLength={80} value={iconName} onChange={e=>setIconName(e.target.value)}/></label><label>이미지 업로드<input key={uploadKey} required type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setIconFile(e.target.files[0])}/></label><small>PNG·JPEG·WebP, 최대 2MB · 서버에서 128px PNG로 변환</small><button className="admin-primary" disabled={busy}>아이콘 등록</button></form><label className="admin-search-label">이름으로 찾기<input value={iconQuery} onChange={e=>setIconQuery(e.target.value)}/></label><div className="icon-library">{icons.filter(i=>i.name.toLowerCase().includes(iconQuery.toLowerCase())).map(i=><article key={i.id}><img src={i.url} alt={i.name}/><strong>{i.name}</strong></article>)}</div>{!icons.length && <p className="admin-empty">등록된 아이콘이 없습니다.</p>}</>}
        {tab === 'officers' && <><div className="admin-section-title"><div><p>PATROL TEAM</p><h1>순찰자 관리</h1></div></div><form className="admin-form" onSubmit={createOfficer}><label>새 순찰자 이름<input required maxLength={80} value={officerName} onChange={e=>setOfficerName(e.target.value)} placeholder="예: 서면 순찰 1호"/></label><button disabled={busy} className="admin-primary">순찰자 생성</button></form><p className="admin-hint">현재 위치는 5초마다 수신하고 방향은 실시간으로 반영합니다. 마지막 수신 시각과 GPS·데모 구분을 확인하세요.</p>{officers.map(o=><article className="admin-officer-card" key={o.id}><form onSubmit={e=>renameOfficer(e,o)}><input name="name" required maxLength={80} defaultValue={o.name} aria-label={`${o.name} 이름`}/><button>이름 저장</button></form><div className="admin-officer-meta"><span>{o.active_patrol_id?'순찰 중':'대기'} · {o.source || '위치 미수신'}</span><small>마지막 수신: {formatTime(o.updated_at)}</small></div><div className="admin-card-actions"><a href={o.url}>{o.url} 접속 ↗</a><button disabled={o.lat==null} onClick={()=>{setHistory(null);setSelected({...o});}}>지도 위치</button></div></article>)}{!officers.length && <p className="admin-empty">순찰자를 생성하면 개별 접속 주소가 발급됩니다.</p>}</>}
        {tab === 'history' && (history ? <>
          <button className="history-back" onClick={()=>setHistory(null)}>← 순찰 기록 목록으로</button>
          <div className="admin-section-title"><div><p>PATROL DETAILS</p><h1>{history.officer_name} · 순찰 #{history.id}</h1></div></div>
          <p className="history-state" role="status">{history.ended_at ? (history.result?.legacy ? '순찰 종료 · 참고 결과' : '순찰 종료 · 최종 결과') : '순찰 진행 중 · 5초마다 갱신'}{history.source==='demo'?' · 데모 포함':''}</p>
          <dl className="history-times"><dt>시작</dt><dd>{formatTime(history.started_at)}</dd><dt>종료</dt><dd>{history.ended_at?formatTime(history.ended_at):'진행 중'}</dd></dl>
          {history.result ? <>
            <div className="history-metrics"><article><small>순찰 시간</small><strong>{duration(history.result.duration_seconds)}</strong></article><article><small>이동 거리</small><strong>{(history.result.distance_m/1000).toFixed(2)} km</strong></article><article><small>방문 강화구역</small><strong>{history.result.visited_zone_count}곳</strong></article><article><small>총 진입</small><strong>{history.result.entry_count}회</strong></article></div>
            <h2>강화구역별 순찰 결과</h2>
            {history.result.zones.map(zone=><article className="history-zone" key={zone.id}><strong>{zone.name}</strong><p>진입 <b>{zone.entry_count}회</b> · 구역 내 체류 <b>{duration(zone.dwell_seconds)}</b></p><small>반지름 {zone.radius}m · 재진입 기준 {Math.round(zone.radius*zone.multiplier)}m</small>{zone.first_entry_at && <small>첫 진입 {formatTime(zone.first_entry_at)}<br/>최근 진입 {formatTime(zone.last_entry_at)}</small>}</article>)}
            {!history.result.zones.length && <p className="admin-empty">이 순찰에 적용된 강화구역이 없습니다.</p>}
            <p className="admin-hint">저장 좌표 {history.points.length}개를 지도에 연결합니다. 체류 시간은 좌표 표본 기준 추정치이며 30초를 넘는 수신 공백은 제외합니다. 겹치는 구역은 각각 집계합니다. 이동 중 통과했어도 구역 안 좌표가 없으면 진입으로 세지 않습니다.</p>
            {history.result.legacy && <p className="admin-hint">기존 기록: 당시 구역 설정이 없어 현재 강화구역 설정으로 재계산한 참고 결과입니다.</p>}
          </> : <p>결과를 불러오는 중입니다.</p>}
        </> : <><div className="admin-section-title"><div><p>PATROL HISTORY</p><h1>순찰 기록</h1></div></div><label className="admin-search-label">순찰자<select value={filterOfficer} onChange={e=>setFilterOfficer(e.target.value)}><option value="">전체 순찰자</option>{officers.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{patrols.map(p=><button className="admin-history-card" key={p.id} onClick={async()=>{try{setSelected(null);setHistory(await api(`/patrols/${p.id}`));}catch(e){setMessage(e.message);}}}><strong>{p.officer_name} · 순찰 #{p.id}</strong><span>{p.source==='demo'?'데모 시작':'GPS 시작'} · {p.ended_at?'종료':'진행 중'}</span><small>{formatTime(p.started_at)} ~ {p.ended_at?formatTime(p.ended_at):'진행 중'}</small></button>)}{!patrols.length && <p className="admin-empty">저장된 순찰 기록이 없습니다.</p>}</>)}
      </div>
    </section><section className="admin-map-area" aria-label="관리자 지도"><ManagedMap places={places} icons={icons} officers={officers} selected={selected} history={history} onSelect={editPlace}/><div className="admin-map-legend"><strong>관리 지도</strong><span>▲ 순찰자　⌖ 등록 지점</span><small>주황 실선: 진입 범위 · 점선: 재진입 완충 범위</small></div></section></div>
  </div>;
}
