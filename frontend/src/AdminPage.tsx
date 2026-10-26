import { BrowserSpeech } from './browserSpeech';
import type { Place, PlaceForm, Address, Icon, Officer, Patrol, PatrolDetail, MapSelection, AlertType, InspectionRecord, Coordinates } from './types';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ManagedMap, { ADMIN_DEFAULT_CENTER } from './ManagedMap';
import PlaceDetails from './PlaceDetails';
import { nearbyPlaces, formatDistance } from './nearbyPlaces';
import { api, jsonBody } from './api';
import { findAddress } from './addressSearch';
import PostcodeSearch from './PostcodeSearch';
import { NOTIFICATION_TYPES } from './notificationTypes';
import './admin.css';
import OfficerAccessLink from './OfficerAccessLink';
import PlaceCsvImport from './PlaceCsvImport';
import { logout } from './accessClient';

const emptyPlace = (): PlaceForm => ({ name: '', category: '여성 1인 사업장', address: '', postal_code: '', detail: '', icon_id: '', enhanced: false, radius: 50, multiplier: 1.2, message: '', alert_type: 'warning' });
const duration = (value: number) => `${Math.floor((value || 0)/60)}분 ${Math.floor((value || 0)%60)}초`;
const formatTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('ko-KR') : '수신 대기';

export default function AdminPage() {
  const [tab, setTab] = useState('places'), [places, setPlaces] = useState<Place[]>([]), [icons, setIcons] = useState<Icon[]>([]), [officers, setOfficers] = useState<Officer[]>([]);
  const [form, setForm] = useState(emptyPlace), [editId, setEditId] = useState<number | null>(null), [selected, setSelected] = useState<MapSelection | null>(null);
  const [query, setQuery] = useState(''), [candidates, setCandidates] = useState<Address[]>([]), [iconQuery, setIconQuery] = useState('');
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [officerName, setOfficerName] = useState('');
  const lookupSequence = useRef(0);
  const [addressLookup, setAddressLookup] = useState(false);
  const [placeView, setPlaceView] = useState<'list' | 'detail' | 'form' | 'import'>('list');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [mapCenter, setMapCenter] = useState(ADMIN_DEFAULT_CENTER);
  const [inspectionRecords, setInspectionRecords] = useState<InspectionRecord[]>([]);
  const [inspectionLoading, setInspectionLoading] = useState(false), [inspectionError, setInspectionError] = useState('');
  const detailPlace = places.find(place=>place.id===detailId);
  const sortedPlaces = nearbyPlaces(places, mapCenter);
  useEffect(() => {
    if (tab !== 'places' || placeView !== 'detail' || detailId === null) return;
    let disposed = false;
    setInspectionLoading(true); setInspectionError(''); setInspectionRecords([]);
    async function update() {
      try { const data = await api<InspectionRecord[]>(`/places/${detailId}/inspections`); if (!disposed) { setInspectionRecords(data); setInspectionError(''); } }
      catch(e) { if (!disposed) setInspectionError(e.message); }
      finally { if (!disposed) setInspectionLoading(false); }
    }
    update(); const timer = setInterval(update, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [tab, placeView, detailId]);
  function openPlace(place: Place) { officerNavigation.current++; setTab('places'); setHistory(null); setDetailId(place.id); setSelected(place); setPlaceView('detail'); setMessage(''); }
  function backToPlaces() { setPlaceView('list'); setDetailId(null); setSelected(null); setMessage(''); setPostcodeOpen(false); }
  async function openInspectionPatrol(id: number) { try { const data = await api<PatrolDetail>(`/patrols/${id}`); setSelected(null); setHistory(data); setTab('history'); } catch(e) { setMessage(e.message); } }
  useEffect(() => { lookupSequence.current++; setAddressLookup(false); return () => { lookupSequence.current++; }; }, [tab, placeView]);
  async function pickMapPosition(point: Coordinates) {
    if (tab !== 'places' || placeView !== 'form' || busy) return;
    const sequence = ++lookupSequence.current;
    setAddressLookup(true); setMessage('선택한 위치의 주소를 찾고 있습니다.'); setCandidates([]); setQuery('');
    setForm(previous=>({...previous,...point,address:'',postal_code:'',detail:''})); setSelected({...point});
    try {
      const result = await api<Address & {kind: string}>(`/reverse-geocode?lat=${point.lat}&lng=${point.lng}`);
      if (sequence !== lookupSequence.current) return;
      setForm(previous=>({...previous,...point,address:result.address,postal_code:result.postal_code}));
      setQuery(result.address); setSelected({...point,address:result.address});
      setMessage(result.kind==='legalcode' ? '상세 주소가 없어 지역명만 입력했습니다. 주소를 확인·보완해 주세요.' : '지도 위치와 주소를 입력했습니다. 지점 이름 등 나머지 정보를 입력해 주세요.');
    } catch(e) { if (sequence === lookupSequence.current) setMessage(e.message + ' 선택한 지도 위치는 유지됩니다.'); }
    finally { if (sequence === lookupSequence.current) setAddressLookup(false); }
  }
  const [postcodeOpen, setPostcodeOpen] = useState(false);
  const speechPlayer = useRef<BrowserSpeech | null>(null);
  useEffect(()=>()=>{speechPlayer.current?.dispose();},[]);
  const speechText = form.message.trim() || `${form.name.trim()} 범죄예방 강화구역이 있습니다. 주변을 확인해 주세요.`;
  function previewSpeech() {
    speechPlayer.current ||= new BrowserSpeech(error=>setMessage(error.message));
    const player = speechPlayer.current;
    player.cancel();
    player.enable().then(()=>player.speak(speechText)).catch(error=>setMessage(error.message));
    setMessage('이 기기의 기본 한국어 TTS로 미리듣기합니다.');
  }
  const [categoryEdit, setCategoryEdit] = useState<number | null>(null), [iconName, setIconName] = useState(''), [iconFile, setIconFile] = useState<File | null>(null), [uploadKey, setUploadKey] = useState(0);
  const [patrols, setPatrols] = useState<Patrol[]>([]), [filterOfficer, setFilterOfficer] = useState(''), [history, setHistory] = useState<PatrolDetail | null>(null);
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
    async function update() { try { const data = await api<Patrol[]>('/patrols' + (filterOfficer ? '?officer_id=' + filterOfficer : '')); if (!disposed) setPatrols(data); } catch(e) { if (!disposed) setMessage(e.message); } }
    update(); const timer = setInterval(update, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [tab, filterOfficer]);
  const officerNavigation = useRef(0);
  useEffect(()=>{if(tab!=='history')officerNavigation.current++;},[tab]);
  useEffect(()=>()=>{officerNavigation.current++;},[]);
  async function showOfficer(id: number) {
    const officer=officers.find(item=>item.id===id);
    if(!officer)return;
    const request=++officerNavigation.current;
    setHistory(null);setMessage('');
    if(!officer.active_patrol_id){
      setTab('officers');
      setSelected(officer.lat!==null && officer.lng!==null?{id:officer.id,lat:officer.lat,lng:officer.lng}:null);
      setMessage(officer.lat===null?`${officer.name}: 아직 수신한 위치가 없습니다.`:`${officer.name}: 순찰 대기 중입니다. 현재 위치를 표시합니다.`);
      return;
    }
    setTab('history');setSelected(null);setMessage(`${officer.name} 순찰 경로를 불러오고 있습니다.`);
    try{
      const detail=await api<PatrolDetail>(`/patrols/${officer.active_patrol_id}`);
      if(request!==officerNavigation.current)return;
      setHistory(detail);setMessage('');
    }catch(e){if(request===officerNavigation.current)setMessage(e.message);}
  }
  const historyId = history?.id;
  useEffect(() => {
    if (tab !== 'history' || !historyId) return;
    let disposed = false;
    async function update() {
      try { const detail = await api<PatrolDetail>(`/patrols/${historyId}`); if (!disposed) setHistory(detail); }
      catch(e) { if (!disposed) setMessage(e.message); }
    }
    const timer = setInterval(update, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [tab, historyId]);
  const updateForm = <K extends keyof PlaceForm,>(key: K, value: PlaceForm[K]) => setForm(previous => ({ ...previous, [key]: value }));
  function editPlace(place: Place) { setPlaceView('form'); speechPlayer.current?.cancel(); setTab('places'); setForm({ ...place, icon_id: place.icon_id ?? '' }); setEditId(place.id); setSelected(place); setQuery(place.address); setCandidates([]); setMessage(''); }
  function clearForm() { const category=icons.find(icon=>icon.name==='여성 1인 사업장') ?? icons[0];setForm({...emptyPlace(),category:category?.name ?? '',icon_id:category?.id ?? ''}); setEditId(null); setQuery(''); setCandidates([]); setSelected(null); }
  async function searchAddress(address = query, postalCode = '') {
    lookupSequence.current++; setAddressLookup(false);
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
  function chooseAddress(result: Address) { lookupSequence.current++; setAddressLookup(false); setForm(f => ({ ...f, ...result })); setSelected(result); setCandidates([]); setQuery(result.address); }
  async function savePlace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (addressLookup) return; if (!form.address.trim()) { setMessage('주소를 입력해 주세요.'); return; } if (!Number.isFinite(form.lat) || !Number.isFinite(form.lng)) { setMessage('주소 검색 결과를 선택해 위치를 확인해 주세요.'); return; }
    setBusy(true); setMessage('');
    try {
      const payload = { ...form, icon_id: form.icon_id ? Number(form.icon_id) : null, radius: Number(form.radius) };
      const result = await api<Place>(editId ? `/places/${editId}` : '/places', { method: editId ? 'PUT' : 'POST', body: jsonBody(payload) });
      await refresh(); clearForm(); openPlace(result); setMessage('지점을 저장했습니다. 순찰자 화면에도 반영됩니다.');
    } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function deletePlace(place: Place) {
    if (!window.confirm(`${place.name} 지점을 삭제할까요?`)) return;
    try { await api(`/places/${place.id}`, { method: 'DELETE' }); clearForm(); backToPlaces(); await refresh(); setMessage('지점을 삭제했습니다.'); } catch(e) { setMessage(e.message); }
  }
  async function createOfficer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try { const item = await api<Officer>('/officers', { method: 'POST', body: jsonBody({ name: officerName }) }); setOfficerName(''); setOfficers(previous=>[...previous,item].sort((a,b)=>a.id-b.id)); await refresh(); setMessage(`${item.name} 생성 완료 · ${item.url}`); } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function removeOfficer(officer: Officer) {
    if (officer.active_patrol_id) { setMessage('진행 중인 순찰을 먼저 종료해 주세요.'); return; }
    if (!window.confirm(`${officer.name} 순찰자를 제거할까요? 접속 목록·지도에서 제외되며 과거 순찰 기록은 보존됩니다.`)) return;
    setBusy(true); setMessage('');
    try { await api(`/officers/${officer.id}`, {method:'DELETE'}); setOfficers(previous=>previous.filter(item=>item.id!==officer.id)); setMessage(`${officer.name} 순찰자를 제거했습니다. 과거 순찰 기록은 보존됩니다.`); }
    catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  async function renameOfficer(event: React.FormEvent<HTMLFormElement>, officer: Officer) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { await api(`/officers/${officer.id}`, { method: 'PATCH', body: jsonBody({ name: data.get('name') }) }); await refresh(); setMessage('순찰자 이름을 변경했습니다.'); } catch(e) { setMessage(e.message); }
  }
  async function uploadIcon(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!iconFile && categoryEdit===null) return;
    setBusy(true); const data = new FormData(); data.append('name', iconName); if(iconFile)data.append('file', iconFile);
    try { await api(categoryEdit===null?'/icons':`/icons/${categoryEdit}`, { method: categoryEdit===null?'POST':'PUT', body: data }); await refresh(); setIconName(''); setIconFile(null); setUploadKey(k => k+1); setCategoryEdit(null);setMessage('지점 분류를 저장했습니다. 연결된 지점에도 반영됩니다.'); } catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }

  return <div className="admin-workspace">
    <header className="admin-topbar"><div><a href="/" className="admin-brand">SMART PATROL</a><span>관리자 워크스페이스</span></div><div><a href="/user">순찰자 선택 ↗</a><button onClick={()=>logout().catch(e=>setMessage(e.message))}>접속 종료</button></div></header>
    <div className="admin-body"><section className="admin-editor">
      <nav className="admin-tabs" aria-label="관리자 메뉴">{[['places','지점 관리'],['icons','지점 분류'],['officers','순찰자'],['history','순찰 기록']].map(([id,label]) => <button key={id} className={tab===id?'selected':''} onClick={()=>{officerNavigation.current++;setTab(id);setHistory(null);backToPlaces();}}>{label}</button>)}</nav>
      {message && <p className="admin-message" role="status">{message}</p>}
      <div className="admin-scroll">
        {tab === 'places' && placeView === 'list' && <>
          <div className="admin-section-title"><div><p>MAP LOCATIONS</p><h1>지점 관리</h1></div><div className="place-add-actions"><button className="place-upload" onClick={()=>{clearForm();setPlaceView('import');}}>위치 파일 추가</button><button className="place-create" onClick={()=>{clearForm();speechPlayer.current?.cancel();setPlaceView('form');}}>＋ 새 지점 등록</button></div></div>
          <p className="admin-hint">지도를 움직이면 지도 중심에서 가까운 순으로 정렬됩니다. 거리는 직선 거리입니다.</p>
          <p className="place-list-count">등록 지점 {places.length}곳 · 가까운 순</p>
          {sortedPlaces.map(({place,distance})=><button className="nearby-place-card" key={place.id} onClick={()=>openPlace(place)}><span className="nearby-place-icon">{icons.find(i=>i.id===place.icon_id) ? <img src={icons.find(i=>i.id===place.icon_id)!.url} alt=""/> : '⌖'}</span><span className="nearby-place-info"><strong>{place.name}</strong><span>{place.category}{place.enhanced?' · 강화구역':''}</span><small>{place.address}</small></span><span className="nearby-place-distance">{formatDistance(distance)}<span>상세 보기 →</span></span></button>)}
          {!places.length && <p className="admin-empty">등록된 지점이 없습니다. 새 지점을 등록해 주세요.</p>}
        </>}
        {tab === 'places' && placeView === 'import' && <PlaceCsvImport onBack={backToPlaces} onImported={count=>{backToPlaces();refresh().catch(e=>setMessage(e.message));setMessage(`${count}개 지점을 일괄 등록했습니다.`);}}/>}
        {tab === 'places' && placeView === 'detail' && (detailPlace ? <PlaceDetails place={detailPlace} icon={icons.find(i=>i.id===detailPlace.icon_id)} records={inspectionRecords} loading={inspectionLoading} error={inspectionError} onBack={backToPlaces} onEdit={()=>editPlace(detailPlace)} onDelete={()=>deletePlace(detailPlace)} onPatrol={openInspectionPatrol}/> : <><button className="history-back" onClick={backToPlaces}>← 지점 목록으로</button><p>지점이 삭제되었거나 존재하지 않습니다.</p></>)}
        {tab === 'places' && placeView === 'form' && <>
          <button className="history-back" onClick={()=>{setPostcodeOpen(false); if(editId && detailPlace) setPlaceView('detail'); else backToPlaces();}}>← {editId && detailPlace?'지점 상세정보로':'지점 목록으로'}</button>
          <div className="admin-section-title"><div><p>MAP LOCATIONS</p><h1>{editId ? '지점 수정' : '새 지점 등록'}</h1></div></div>
          <p className="admin-hint" role="status">지도에서 원하는 위치를 클릭하면 위치와 주소가 자동 입력됩니다. 도로명 주소 검색으로도 지정할 수 있습니다.</p>
          <form onSubmit={savePlace} className="admin-form">
            <label>지점 이름<input required maxLength={100} value={form.name} onChange={e=>updateForm('name',e.target.value)} placeholder="예: ○○ 사업장" /></label>
            <label>분류<select required value={form.icon_id} onChange={e=>{const category=icons.find(icon=>icon.id===Number(e.target.value));setForm(previous=>({...previous,category:category?.name ?? '',icon_id:category?.id ?? ''}));}}><option value="" disabled>지점 분류를 선택하세요</option>{icons.map(icon=><option key={icon.id} value={icon.id}>{icon.name}</option>)}</select></label>
            {icons.find(icon=>icon.id===Number(form.icon_id)) && <div className="category-selection"><img src={icons.find(icon=>icon.id===Number(form.icon_id))!.url} alt="선택한 분류 아이콘"/><span>{form.category}</span></div>}
            {!icons.length && <p className="admin-hint">지점 분류 메뉴에서 분류와 아이콘을 먼저 등록해 주세요.</p>}
            <label>도로명 주소 검색<div className="admin-input-row"><input value={query} onChange={e=>{setQuery(e.target.value);setForm(f=>({...f,address:'',lat:undefined,lng:undefined}));}} placeholder="도로명 + 건물 번호" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(query.trim().length>=3 && !busy)searchAddress();}}} /><button type="button" disabled={busy || query.length<3} onClick={()=>searchAddress()}>검색</button></div></label>
            <button className="admin-secondary" type="button" disabled={busy} onClick={()=>setPostcodeOpen(true)}>우편번호·주소 찾기</button>
            {postcodeOpen && <PostcodeSearch onClose={()=>setPostcodeOpen(false)} onComplete={result=>{setPostcodeOpen(false);setQuery(result.address);setForm(f=>({...f,address:result.address,postal_code:result.postal_code,lat:undefined,lng:undefined}));searchAddress(result.address,result.postal_code);}} />}
            {!!candidates.length && <div className="address-candidates">{candidates.map((c,i)=><button type="button" key={i} onClick={()=>chooseAddress(c)}><strong>{c.address}</strong><small>{c.postal_code || '우편번호 없음'} · 선택하여 지도 확인</small></button>)}</div>}
            {form.address && <p className="admin-address-selected">{Number.isFinite(form.lat) && Number.isFinite(form.lng) ? '✓' : '…'} {form.address}<small>우편번호 {form.postal_code || '미제공'} · {Number.isFinite(form.lat) && Number.isFinite(form.lng) ? '지도 위치 확인 완료' : '좌표 변환이 필요합니다. 주소 검색을 완료해 주세요.'}</small></p>}
            {Number.isFinite(form.lat) && Number.isFinite(form.lng) && <label>등록 주소<input required value={form.address} onChange={e=>{lookupSequence.current++;setAddressLookup(false);updateForm('address',e.target.value);}} placeholder="자동 변환 실패 시 주소를 직접 입력해 주세요."/><small>{addressLookup?'주소 자동 입력 중…':'지도에서 선택한 좌표로 저장합니다. 주소 수정은 좌표를 변경하지 않습니다.'}</small></label>}
            <label>상세 주소<input maxLength={200} value={form.detail} onChange={e=>updateForm('detail',e.target.value)} placeholder="동·층·호수 등" /></label>
            <fieldset className="enhanced-settings"><label className="admin-check"><input type="checkbox" checked={form.enhanced} onChange={e=>updateForm('enhanced',e.target.checked)} />범죄예방 강화구역</label>{form.enhanced && <>
              <label>진입 반지름 (m)<input required type="number" min={5} max={10000} value={form.radius} onChange={e=>updateForm('radius',Number(e.target.value))} /></label>
              <small>반지름을 바꾸면 지도에서 저장 전 범위를 확인할 수 있습니다.</small>
              <label>알림 타입<select value={form.alert_type} onChange={e=>updateForm('alert_type',e.target.value as AlertType)}>{Object.entries(NOTIFICATION_TYPES).map(([id,type])=><option key={id} value={id}>{type.label}</option>)}</select></label>
              <label>음성 안내 문구<textarea maxLength={500} value={form.message} onChange={e=>updateForm('message',e.target.value)} placeholder="비워두면 기본 안내 · 방향은 순찰자 기준으로 자동 추가" /></label>
              <small>기기의 기본 한국어 TTS를 사용합니다. 기기마다 목소리가 다를 수 있습니다.</small>
              <button type="button" className="admin-secondary" disabled={!form.name.trim()} onClick={previewSpeech}>안내 음성 미리듣기</button>
            </>}</fieldset>
            <button className="admin-primary" disabled={busy || addressLookup} type="submit">{busy?'처리 중…':editId?'지점 수정 저장':'지점 등록'}</button>
          </form>

        </>}
        {tab === 'icons' && <><div className="admin-section-title"><div><p>PLACE CATEGORIES</p><h1>지점 분류</h1></div></div><p className="admin-hint">분류 이름과 아이콘을 함께 관리합니다. 지점에서 분류를 선택하면 아이콘이 자동 적용됩니다.</p><form className="admin-form" onSubmit={uploadIcon}><h2>{categoryEdit===null?'새 분류 등록':'분류 수정'}</h2><label>분류 이름<input required maxLength={80} value={iconName} onChange={e=>setIconName(e.target.value)}/></label><label>{categoryEdit===null?'분류 아이콘':'아이콘 변경 (선택)'}<input key={uploadKey} required={categoryEdit===null} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setIconFile(e.target.files?.[0] ?? null)}/></label><small>PNG·JPEG·WebP, 최대 2MB · 수정 시 이미지를 선택하지 않으면 기존 아이콘을 유지합니다.</small><button className="admin-primary" disabled={busy}>{categoryEdit===null?'분류 등록':'분류 수정 저장'}</button>{categoryEdit!==null && <button type="button" className="admin-secondary" onClick={()=>{setCategoryEdit(null);setIconName('');setIconFile(null);setUploadKey(k=>k+1);}}>수정 취소</button>}</form><label className="admin-search-label">분류 찾기<input value={iconQuery} onChange={e=>setIconQuery(e.target.value)}/></label><div className="category-library">{icons.filter(i=>i.name.toLowerCase().includes(iconQuery.toLowerCase())).map(i=><article className="category-card" key={i.id}><img src={i.url} alt=""/><strong>{i.name}</strong><button onClick={()=>{setCategoryEdit(i.id);setIconName(i.name);setIconFile(null);setUploadKey(k=>k+1);}}>수정</button></article>)}</div>{!icons.length && <p className="admin-empty">등록된 분류가 없습니다.</p>}</>}
        {tab === 'officers' && <><div className="admin-section-title"><div><p>PATROL TEAM</p><h1>순찰자 관리</h1></div></div><form className="admin-form" onSubmit={createOfficer}><label>새 순찰자 이름<input required maxLength={80} value={officerName} onChange={e=>setOfficerName(e.target.value)} placeholder="예: 서면 순찰 1호"/></label><button disabled={busy} className="admin-primary">순찰자 생성</button></form><p className="admin-hint">현재 위치는 5초마다 수신하고 방향은 실시간으로 반영합니다. 마지막 수신 시각과 GPS·데모 구분을 확인하세요.</p>{officers.map(o=><article className="admin-officer-card" key={o.id}><form onSubmit={e=>renameOfficer(e,o)}><input name="name" required maxLength={80} defaultValue={o.name} aria-label={`${o.name} 이름`}/><button disabled={busy}>이름 저장</button></form><div className="admin-officer-meta"><span>{o.active_patrol_id?'순찰 중':'대기'} · {o.source || '위치 미수신'}</span><small>마지막 수신: {formatTime(o.updated_at)}</small></div><div className="admin-card-actions"><a href={o.url}>{o.url} 접속 ↗</a><button disabled={o.lat==null && !o.active_patrol_id} onClick={()=>showOfficer(o.id)}>{o.active_patrol_id?'순찰 경로 보기':'지도 위치'}</button></div><OfficerAccessLink officerId={o.id}/><div className="officer-remove-row"><small>{o.active_patrol_id?'순찰 종료 후 제거할 수 있습니다.':'제거해도 과거 순찰 기록은 보존됩니다.'}</small><button className="admin-danger" disabled={busy || o.active_patrol_id!==null} onClick={()=>removeOfficer(o)}>순찰자 제거</button></div></article>)}{!officers.length && <p className="admin-empty">순찰자를 생성하면 개별 접속 주소가 발급됩니다.</p>}</>}
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
    </section><section className="admin-map-area" aria-label="관리자 지도"><ManagedMap places={tab==='places' && placeView==='form'?places.filter(place=>place.id!==editId):places} draft={tab==='places' && placeView==='form'?form:null} icons={icons} officers={officers} selected={selected} history={history} onSelect={place=>{if(tab==='places' && placeView==='form') pickMapPosition({lat:place.lat,lng:place.lng}); else openPlace(place);}} onOfficerSelect={showOfficer} onMapClick={pickMapPosition} onCenterChanged={setMapCenter}/><div className="admin-map-legend"><strong>관리 지도</strong><span>▲ 순찰자　⌖ 등록 지점</span><small>주황 원: 범죄예방 강화구역 · 파란 원: 저장 전 미리보기</small></div></section></div>
  </div>;
}
