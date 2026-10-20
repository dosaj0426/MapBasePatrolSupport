import { loadMap } from './naverMap.js';
import React, { useEffect, useRef, useState } from 'react';
import './patrol.css';
import './directionMarker.css';
import './notificationCards.css';
import { prepareMapTransport } from './mapTransport.js';
import { moveTenMeters } from './location.js';
import NotificationCard from './NotificationCard.jsx';
import { PatrolTrack } from './patrolTrack.js';
import { api } from './api.js';
import { putPlaceOverlays } from './ManagedMap.jsx';
import usePatrolServer from './usePatrolServer.js?v=heading-sync-2';
import { ServerSpeech } from './serverSpeech.js';
import useHeading from './useHeading.js';
import { navigationIcon, normalizeHeading } from './heading.js';

// 위치 권한 거부·수신 실패 시에만 사용하는 데모 기준점.
const STATION = { lat: 35.1602002, lng: 129.054338 };
export default function PatrolPage({ officerId }) {
  const canvas = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const gpsWatch = useRef(null);
  const gpsGeneration = useRef(0);
  const latestPosition = useRef(STATION);
  const demoOrigin = useRef(STATION);
  const track = useRef(new PatrolTrack());
  const routeLine = useRef(null);
  const routeStart = useRef(null);
  const routeEnd = useRef(null);
  const [position, setPosition] = useState(STATION);
  const [following, setFollowing] = useState(true);
  const [locationMode, setLocationMode] = useState('gps');
  const direction = useHeading(locationMode);
  const [locationMessage, setLocationMessage] = useState('현재 위치를 확인하고 있습니다. 위치 권한을 허용해 주세요.');
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState(false);
  const [started, setStarted] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [mapState, setMapState] = useState('loading');
  const [mapError, setMapError] = useState('');
  const [notificationHeight, setNotificationHeight] = useState(() => {
    try { const saved = Number(localStorage.getItem('patrol-notification-height')); return saved >= 240 && saved <= 900 ? saved : 340; } catch { return 340; }
  });
  const notificationResize = useRef(null);
  useEffect(() => {
    try { localStorage.setItem('patrol-notification-height', String(notificationHeight)); } catch { /* 저장 불가 환경에서도 크기 조절은 동작한다. */ }
  }, [notificationHeight]);

  function resizeNotification(value) {
    const max = Math.max(240, Math.min(900, window.innerHeight - 200));
    setNotificationHeight(Math.round(Math.max(240, Math.min(max, value))));
  }

  function startNotificationResize(event) {
    if (event.button !== 0) return;
    const panel = event.currentTarget.closest('.notification-panel');
    notificationResize.current = { y: event.clientY, height: panel.getBoundingClientRect().height };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const unreadCount = notifications.filter(item => !item.read).length;
  const [places, setPlaces] = useState([]), [placeIcons, setPlaceIcons] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceWaiting, setVoiceWaiting] = useState(true);
  const voiceReady = useRef(false), pendingSpeech = useRef([]);
  const [voiceError, setVoiceError] = useState('');
  const voiceRef = useRef(true);
  const speechPlayer = useRef(null);
  const restoredId = useRef(null);
  const server = usePatrolServer(officerId, track, handleServerAlert);

  useEffect(() => {
    const value = Number.isFinite(direction.heading) ? normalizeHeading(direction.heading) : null;
    const source = direction.source === '기기 방향' ? 'sensor' : direction.source === '데모 이동 방향' ? 'demo' : value === null ? 'unknown' : 'gps';
    server.reportHeading(value, source);
  }, [direction.heading, direction.source, server.reportHeading]);

  function handleServerAlert(item) {
    receiveNotification(item);
    if (!item.read && voiceRef.current) {
      if (voiceReady.current) speechPlayer.current?.speak(item.body);
      else pendingSpeech.current = [...pendingSpeech.current.filter(a => a.id !== item.id), item].slice(-10);
    }
  }

  function activateVoice() {
    if (!voiceRef.current || voiceReady.current) return;
    try {
      speechPlayer.current ||= new ServerSpeech(() => setVoiceError('음성 안내를 재생하지 못했습니다. 알림 내용을 확인해 주세요.'));
      const player = speechPlayer.current;
      player.enable().then(() => {
        if (speechPlayer.current !== player || !voiceRef.current || voiceReady.current) return;
        voiceReady.current = true; setVoiceWaiting(false);
        const pending = pendingSpeech.current; pendingSpeech.current = [];
        pending.forEach(item => player.speak(item.body));
      }).catch(() => { if (speechPlayer.current === player && voiceRef.current) setVoiceError('화면을 한 번 터치하면 음성 안내를 시작할 수 있습니다.'); });
    } catch { setVoiceError('이 브라우저에서 음성 재생을 사용할 수 없습니다.'); }
  }

  function toggleVoice() {
    setVoiceError('');
    const enabled = !voiceRef.current;
    voiceRef.current = enabled; setVoiceEnabled(enabled); voiceReady.current = false; setVoiceWaiting(enabled);
    if (enabled) activateVoice();
    else { pendingSpeech.current = []; speechPlayer.current?.cancel(); }
  }

  useEffect(() => {
    if (!voiceEnabled) return;
    activateVoice();
    window.addEventListener('pointerup', activateVoice, true);
    window.addEventListener('keydown', activateVoice, true);
    return () => { window.removeEventListener('pointerup', activateVoice, true); window.removeEventListener('keydown', activateVoice, true); };
  }, [voiceEnabled]);

  useEffect(() => () => { speechPlayer.current?.dispose(); speechPlayer.current = null; voiceReady.current = false; }, []);
  useEffect(() => {
    let disposed = false;
    async function update() {
      try { const [p, i] = await Promise.all([api('/places'), api('/icons')]); if (!disposed) { setPlaces(p); setPlaceIcons(i); } }
      catch(e) { if (!disposed) setLocationMessage(e.message); }
    }
    update(); const timer = setInterval(update, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  useEffect(() => { if (mapState === 'ready') return putPlaceOverlays(mapRef.current, places, placeIcons); }, [mapState, places, placeIcons]);

  useEffect(() => {
    if (!server.restore || mapState !== 'ready' || restoredId.current === server.restore.id) return;
    const saved = server.restore;
    restoredId.current = saved.id;
    clearRouteOverlays();
    track.current.active = true;
    track.current.points = saved.points.length ? saved.points : [{ ...latestPosition.current, time: Date.now(), source: 'start' }];
    const maps = window.naver.maps;
    routeLine.current = new maps.Polyline({ map: mapRef.current, path: track.current.points.map(p => new maps.LatLng(p.lat, p.lng)), strokeColor: '#2678ed', strokeWeight: 5, clickable: false });
    routeStart.current = createRouteMarker(track.current.points[0], '시작', 'start');
    setStarted(Date.parse(saved.started_at)); setElapsed(Math.floor((Date.now()-Date.parse(saved.started_at))/1000)); setActive(true);
    setLocationMessage('서버에서 진행 중인 순찰을 복원했습니다.');
  }, [server.restore, mapState]);

  function changePosition(next, source = 'demo', time = Date.now(), accuracy = 0, headingData = {}) {
    direction.positionChanged(latestPosition.current, next, { source, accuracy, ...headingData });
    latestPosition.current = next;
    setPosition(next);
    server.reportPosition(next, source, accuracy);
    if (track.current.record(next, source, time, accuracy) && routeLine.current) {
      routeLine.current.getPath().push(new window.naver.maps.LatLng(next.lat, next.lng));
    }
  }

  function clearRouteOverlays() {
    for (const overlay of [routeLine, routeStart, routeEnd]) { overlay.current?.setMap(null); overlay.current = null; }
  }

  function createRouteMarker(point, label, kind) {
    const maps = window.naver.maps;
    return new maps.Marker({ map: mapRef.current, position: new maps.LatLng(point.lat, point.lng), zIndex: 110, title: label, icon: { content: `<div class="route-endpoint ${kind}">${label}</div>`, anchor: new maps.Point(20, 14) } });
  }

  // 추후 관리자 수신 이벤트도 이 함수로 연결한다.
  function receiveNotification(item) {
    setNotifications(items => [{ ...item, read: item.read ?? false }, ...items.filter(existing => existing.id !== item.id)]);
    if (!item.read) setNotificationsOpen(true);
  }

  async function readNotification(id) {
    const target = notifications.find(item => item.id === id);
    if (target?.serverId) { try { await server.markRead(target.serverId); } catch(e) { server.setError(e.message); return; } }
    pendingSpeech.current = pendingSpeech.current.filter(item => item.id !== id);
    const next = notifications.map(item => item.id === id ? { ...item, read: true } : item);
    setNotifications(next);
    if (!next.some(item => !item.read)) setNotificationsOpen(false);
  }

  useEffect(() => {
    const key = import.meta.env.VITE_NAVER_MAP_KEY_ID;
    if (!key?.trim()) { setMapState('missing'); return; }
    let disposed = false;
    let marker;
    let map;
    let resizeObserver;
    const timeout = setTimeout(() => { if (!disposed) { setMapError('지도 초기화가 지연되고 있습니다. API 인증과 네트워크를 확인해 주세요.'); setMapState('error'); } }, 18000);
    prepareMapTransport().then(() => loadMap(key.trim())).then(maps => {
      if (disposed) return;
      let width = canvas.current.clientWidth;
      let height = canvas.current.clientHeight;
      const initial = latestPosition.current;
      map = new maps.Map(canvas.current, { center: new maps.LatLng(initial.lat, initial.lng), size: new maps.Size(width, height), zoom: 16, zoomControl: false, keyboardShortcuts: false, tileSpare: 0, tileTransition: false });
      maps.Event.addListener(map, 'dragstart', () => setFollowing(false));
      // SDK가 컨테이너 스타일을 갱신해도 실제 크기가 같으면 재렌더링하지 않는다.
      resizeObserver = new ResizeObserver(entries => {
        const nextWidth = Math.round(entries[0].contentRect.width);
        const nextHeight = Math.round(entries[0].contentRect.height);
        if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height)) return;
        width = nextWidth;
        height = nextHeight;
        map.setSize(new maps.Size(width, height));
      });
      resizeObserver.observe(canvas.current.parentElement);
      marker = new maps.Marker({ map, position: new maps.LatLng(STATION.lat, STATION.lng), title: '부산진경찰서', icon: { content: '<div class="station-pin">♜<span>부산진경찰서</span></div>', anchor: new maps.Point(22, 44) } });
      userMarkerRef.current = new maps.Marker({ map, position: new maps.LatLng(STATION.lat, STATION.lng), title: '내 위치', zIndex: 200, icon: { content: navigationIcon(null), anchor: new maps.Point(20, 20) } });
      mapRef.current = map;
      setMapState('ready');
      clearTimeout(timeout);
    }).catch(error => { clearTimeout(timeout); if (!disposed) { setMapError(error.message); setMapState('error'); } });
    return () => { disposed = true; clearTimeout(timeout); resizeObserver?.disconnect(); clearRouteOverlays(); marker?.setMap(null); userMarkerRef.current?.setMap(null); userMarkerRef.current = null; if (map) { window.naver.maps.Event.clearInstanceListeners(map); map.destroy(); } mapRef.current = null; };
  }, []);

  useEffect(() => {
    latestPosition.current = position;
    if (mapState !== 'ready') return;
    const coordinate = new window.naver.maps.LatLng(position.lat, position.lng);
    userMarkerRef.current?.setPosition(coordinate);
    if (following) mapRef.current?.setCenter(coordinate);
  }, [position, following, mapState]);

  useEffect(() => {
    if (mapState !== 'ready') return;
    const pin = canvas.current?.querySelector('.user-location-pin');
    if (!pin) return;
    const known = Number.isFinite(direction.heading);
    pin.classList.toggle('heading-unknown', !known);
    pin.setAttribute('aria-label', known ? `내 방향 ${Math.round(normalizeHeading(direction.heading))}도 · ${direction.source}` : '내 위치 · 방향 정보 대기');
    const arrow = pin.querySelector('.user-heading-arrow');
    if (arrow) arrow.style.transform = `rotate(${known ? direction.heading : 0}deg)`;
  }, [direction.heading, direction.source, mapState]);

  useEffect(() => {
    if (mapState !== 'ready') return;
    const map = mapRef.current;
    function onShiftClick(event) {
      const pointer = event.pointerEvent?.originalEvent ?? event.pointerEvent;
      if (!pointer?.shiftKey || (pointer.button !== undefined && pointer.button !== 0)) return;
      // SDK가 현재 줌·패닝·투영을 반영해 계산한 좌표를 그대로 사용한다.
      const coordinate = event.coord ?? event.latlng;
      if (!coordinate) return;
      pointer.preventDefault?.();
      gpsGeneration.current += 1;
      if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
      gpsWatch.current = null;
      const next = { lat: coordinate.lat(), lng: coordinate.lng() };
      setFollowing(false);
      setLocationMode('demo');
      setLocationMessage('고정 해제 후 클릭한 위치로 이동 · 방향키 10m');
      changePosition(next, 'demo');
    }
    const listener = window.naver.maps.Event.addListener(map, 'click', onShiftClick);
    return () => window.naver.maps.Event.removeListener(listener);
  }, [mapState]);

  useEffect(() => {
    function onKey(event) {
      if (mapState !== 'ready' || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"]')) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      // 방향키 데모는 마지막 실제 위치에서 시작하며 GPS가 좌표를 덮어쓰지 않는다.
      if (locationMode !== 'demo') {
        gpsGeneration.current += 1;
        if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
        gpsWatch.current = null;
        setLocationMode('demo');
        setLocationMessage('현재 위치 기준 데모 · 방향키 한 번에 10m 이동');
      }
      changePosition(moveTenMeters(latestPosition.current, event.key), 'demo');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locationMode, mapState]);

  useEffect(() => {
    if (!server.officer) return;
    useGps();
    return () => {
      gpsGeneration.current += 1;
      if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
      gpsWatch.current = null;
    };
  }, [server.officer?.id]);

  function useDemo() {
    gpsGeneration.current += 1;
    if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
    gpsWatch.current = null;
    setLocationMode('demo');
    changePosition(demoOrigin.current, 'demo');
    setFollowing(true);
    setLocationMessage('현재 위치 기준 데모 · 방향키 한 번에 10m 이동');
  }

  function useGps() {
    if (!navigator.geolocation) { setLocationMode('demo'); setLocationMessage('위치 기능 미지원 · 부산진경찰서 기준 데모'); return; }
    const generation = ++gpsGeneration.current;
    if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
    setLocationMode('gps');
    setLocationMessage('위치 권한을 허용하면 실제 위치를 표시합니다.');
    gpsWatch.current = navigator.geolocation.watchPosition(({ coords }) => {
      if (generation !== gpsGeneration.current) return;
      const current = { lat: coords.latitude, lng: coords.longitude };
      demoOrigin.current = current;
      changePosition(current, 'gps', Date.now(), coords.accuracy, { heading: coords.heading, speed: coords.speed });
      setLocationMessage(`GPS 수신 · 정확도 약 ${Math.round(coords.accuracy)}m`);
    }, error => {
      if (generation !== gpsGeneration.current) return;
      if (gpsWatch.current !== null) navigator.geolocation.clearWatch(gpsWatch.current);
      gpsWatch.current = null;
      setLocationMode('demo');
      setLocationMessage(error.code === 1 ? '위치 권한 거부 · 마지막 위치 또는 경찰서 기준 데모' : '위치 수신 실패 · 마지막 위치 또는 경찰서 기준 데모');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
    setFollowing(true);
  }

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active, started]);

  async function togglePatrol() {
    if (!mapRef.current || mapState !== 'ready' || !server.officer || server.busy) return;
    const next = !track.current.active;
    if (next) {
      try { await server.start(locationMode === 'gps' ? 'gps' : 'demo'); } catch(e) { server.setError(e.message); return; }
      clearRouteOverlays();
      const now = Date.now();
      track.current.start(latestPosition.current, now);
      setStarted(now); setElapsed(0);
      const maps = window.naver.maps;
      routeLine.current = new maps.Polyline({ map: mapRef.current, path: [new maps.LatLng(latestPosition.current.lat, latestPosition.current.lng)], strokeColor: '#2678ed', strokeWeight: 5, strokeOpacity: .9, strokeLineCap: 'round', strokeLineJoin: 'round', clickable: false, zIndex: 80 });
      routeStart.current = createRouteMarker(latestPosition.current, '시작', 'start');
    } else {
      track.current.stop();
      try { await server.end(); } catch(e) { track.current.active = true; server.setError(`종료 전송 대기: ${e.message}`); return; }
      setElapsed(Math.floor((Date.now() - started) / 1000));
      routeEnd.current = createRouteMarker(track.current.points.at(-1), '종료', 'end');
    }
    setActive(next);
    receiveNotification({ id: Date.now(), type: 'info', title: next ? '순찰을 시작했습니다' : '순찰을 종료했습니다', body: next ? '이동 경로를 기록하고 5초마다 서버로 전송합니다. 데모 이동도 구분하여 저장합니다.' : `경로 ${track.current.points.length}개 지점을 서버에 저장했습니다. 관리자에서 확인할 수 있습니다.`, time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });
  }
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  if (!server.officer && server.error) return <main className="entry"><h1>순찰자 접속 확인</h1><p role="alert">{server.error}</p><a href="/user">순찰자 목록으로 돌아가기</a></main>;

  return (
    <div className="patrol-screen">
      <div className="map-canvas" ref={canvas} aria-label="사용자 현재 위치 기반 네이버 지도" />
      {mapState === 'ready' && <div className="map-tools map-float" aria-label="지도 조작">
        <button aria-label="지도 확대" onClick={() => mapRef.current?.setZoom(mapRef.current.getZoom() + 1, false)}>+</button>
        <button aria-label="지도 축소" onClick={() => mapRef.current?.setZoom(mapRef.current.getZoom() - 1, false)}>−</button>
        <button aria-label="지도 다시 불러오기" title="지도 다시 불러오기" onClick={() => mapRef.current?.refresh(true)}>↻</button>
        <button aria-label={following ? '내 위치 고정 해제' : '내 위치로 고정'} title={following ? '내 위치 고정 중 · 클릭하여 해제' : '내 위치로 이동하고 고정'} aria-pressed={following} className={`follow-icon-button ${following ? 'is-following' : ''}`} onClick={() => setFollowing(value => !value)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.25"/><path d="M12 1.75v4M12 18.25v4M1.75 12h4M18.25 12h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>
        </button>
      </div>}
      {mapState !== 'ready' && <div className="map-placeholder">
        <div className="map-grid" />
        <div className="placeholder-station"><span>♜</span><strong>부산진경찰서</strong><small>부산진구 부전로111번길 6</small></div>
        <div className="map-config" role="status"><strong>{mapState === 'loading' ? '네이버 지도를 불러오는 중…' : mapState === 'missing' ? '네이버 지도 API 키가 필요합니다' : '지도 연결을 확인해 주세요'}</strong><p>{mapState === 'missing' ? '현재 배경은 UI 배치 확인용이며 실제 지도가 아닙니다.' : mapError}</p>{mapState === 'missing' && <small>frontend/.env에 VITE_NAVER_MAP_KEY_ID 설정 후 개발 서버를 재시작하세요.</small>}<a href="https://map.naver.com/p/search/부산진경찰서" target="_blank" rel="noreferrer">네이버 지도에서 위치 확인 ↗</a></div>
      </div>}

      <div className="top-left-controls"><button className="menu-toggle map-float" aria-label={menu ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menu} aria-controls="patrol-menu" onClick={() => setMenu(!menu)}><span /><span /><span /></button><div className="workspace-chip map-float"><span className="live-dot" />SMART PATROL<span className="chip-divider" />{server.officer?.name || '순찰자 확인 중'}</div></div>
      {menu && <><button className="menu-scrim" aria-label="메뉴 닫기" onClick={() => setMenu(false)} /><nav id="patrol-menu" className="patrol-menu map-float" aria-label="순찰 메뉴"><p>SMART PATROL</p><h2>순찰자 메뉴</h2><button onClick={() => { setFollowing(false); mapRef.current?.setCenter(new window.naver.maps.LatLng(STATION.lat, STATION.lng)); setMenu(false); }}>부산진경찰서로 이동</button><button onClick={() => { useDemo(); setMenu(false); }}>데모 위치 초기화</button><button onClick={() => { useGps(); setMenu(false); }}>실제 GPS 위치 사용</button><small>화살표: {direction.source}{Number.isFinite(direction.heading) ? ` · ${Math.round(normalizeHeading(direction.heading))}°` : ' · 방향 정보 대기'}</small><button onClick={toggleVoice}>{voiceEnabled ? '음성 안내 끄기' : '음성 안내 켜기'}</button><a href="/user">순찰자 선택</a><a href="/">화면 선택</a><a href="/admin">관리자 화면</a><small>위치·경로는 서버로 전송됩니다.</small></nav></>}

      {!notificationsOpen && <button className="notification-toggle map-float" aria-label="알림 열기" aria-expanded={false} aria-controls="patrol-notifications" onClick={() => setNotificationsOpen(true)}><img src="/icons/notification-bell.png" alt="" />{unreadCount > 0 && <span>{unreadCount}</span>}</button>}{notificationsOpen && <section id="patrol-notifications" className="notification-panel map-float" aria-label="순찰 알림" style={{ height: notificationHeight }}><div className="notification-heading"><h2><img className="notification-bell-icon" src="/icons/notification-bell.png" alt="" aria-hidden="true" /> 순찰 알림</h2><div className="notification-heading-actions"><span className="notification-count">{unreadCount}</span><button aria-label="알림 접기" aria-expanded={true} aria-controls="patrol-notifications" onClick={() => setNotificationsOpen(false)}>×</button></div></div><p className="notification-subtitle">순찰 중 확인할 소식을 모아봅니다</p><div className="notification-list" aria-live="polite">{notifications.length === 0 && <p className="notification-empty">받은 알림이 없습니다.</p>}{notifications.map(item => <NotificationCard key={item.id} item={item} onRead={readNotification} />)}</div><div className="notification-resize-handle" role="separator" aria-label="알림창 높이 조절" aria-orientation="horizontal" aria-valuemin={240} aria-valuemax={900} aria-valuenow={notificationHeight} tabIndex={0} title="위아래로 드래그하여 높이 조절" onPointerDown={startNotificationResize} onPointerMove={event => { const start = notificationResize.current; if (start) resizeNotification(start.height + event.clientY - start.y); }} onPointerUp={() => { notificationResize.current = null; }} onPointerCancel={() => { notificationResize.current = null; }} onLostPointerCapture={() => { notificationResize.current = null; }} onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); resizeNotification(notificationHeight + (event.key === 'ArrowDown' ? 20 : -20)); } }}><span /></div></section>}

      <p className="sr-only" role="status">{locationMessage}</p>{server.error && <p className="server-sync-error" role="alert">{server.error}</p>}{voiceError && <p className="voice-playback-error map-float" role="alert">{voiceError}</p>}{voiceEnabled && voiceWaiting && <p className="voice-activation-hint map-float" role="status">화면을 한 번 터치하면 음성 안내가 시작됩니다.</p>}<button className="voice-toggle map-float" onClick={toggleVoice} aria-pressed={voiceEnabled}>{voiceEnabled ? '음성 안내 켜짐' : '음성 안내 켜기'}</button>
      <div className="patrol-actions"><div className="patrol-status map-float"><span className={active ? 'live-dot' : 'idle-dot'} /><span>{active ? '순찰 중' : '순찰 대기'}</span><strong>{clock}</strong></div><button disabled={server.busy || !server.officer || mapState !== 'ready'} className={`patrol-control ${active ? 'stop' : ''}`} onClick={togglePatrol}><span className="control-symbol">{active ? '■' : '▶'}</span><span>{active ? '순찰 종료' : '순찰 시작'}<small>{active ? '진행 중인 순찰 마치기' : '안전한 순찰을 시작하세요'}</small></span><span className="control-arrow">→</span></button></div>
    </div>
  );
}







