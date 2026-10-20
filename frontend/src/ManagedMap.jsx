import React, { useEffect, useRef, useState } from 'react';
import { loadMap } from './naverMap.js';
import { prepareMapTransport } from './mapTransport.js';
import { navigationIcon, turnTo } from './heading.js';
import './directionMarker.css';

export const STATION_CENTER = { lat: 35.1602002, lng: 129.054338 };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function putPlaceOverlays(map, places, icons, onSelect) {
  const maps = window.naver.maps;
  const overlays = [];
  for (const place of places) {
    const point = new maps.LatLng(place.lat, place.lng);
    const icon = icons.find(i => i.id === place.icon_id);
    const marker = new maps.Marker({ map, position: point, title: place.name, icon: { content: `<div class="managed-place-pin">${icon ? `<img src="${escapeHtml(icon.url)}" alt=""/>` : '<span>⌖</span>'}<small>${escapeHtml(place.name)}</small></div>`, anchor: new maps.Point(18, 18) } });
    if (onSelect) maps.Event.addListener(marker, 'click', () => onSelect(place));
    overlays.push(marker);
    if (place.enhanced) {
      overlays.push(new maps.Circle({ map, center: point, radius: place.radius, strokeColor: '#dd7b25', strokeWeight: 2, fillColor: '#ed963d', fillOpacity: .16, clickable: false }));
      overlays.push(new maps.Circle({ map, center: point, radius: place.radius * place.multiplier, strokeColor: '#dd7b25', strokeStyle: 'dash', strokeWeight: 1, fillOpacity: 0, clickable: false }));
    }
  }
  return () => overlays.forEach(o => { maps.Event.clearInstanceListeners(o); o.setMap(null); });
}

export default function ManagedMap({ places = [], icons = [], officers = [], selected, history, onSelect, onReady }) {
  const officerMarkers = useRef(new Map());
  const container = useRef(null), mapRef = useRef(null), handlers = useRef({ onSelect, onReady });
  handlers.current = { onSelect, onReady };
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, map, observer;
    const key = import.meta.env.VITE_NAVER_MAP_KEY_ID;
    if (!key) { setError('지도 API 키를 설정해 주세요.'); return; }
    prepareMapTransport().then(() => loadMap(key)).then(maps => {
      if (disposed) return;
      map = new maps.Map(container.current, { center: new maps.LatLng(STATION_CENTER.lat, STATION_CENTER.lng), zoom: 16, keyboardShortcuts: false, tileTransition: false, tileSpare: 0 });
      let width = container.current.clientWidth, height = container.current.clientHeight;
      observer = new ResizeObserver(() => {
        const w = container.current.clientWidth, h = container.current.clientHeight;
        if (w && h && (w !== width || h !== height)) { width = w; height = h; map.setSize(new maps.Size(w, h)); }
      }); observer.observe(container.current.parentElement);
      mapRef.current = map; setReady(true); handlers.current.onReady?.(map);
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; observer?.disconnect(); map?.destroy(); mapRef.current = null; };
  }, []);
  useEffect(() => { if (ready) return putPlaceOverlays(mapRef.current, places, icons, p => handlers.current.onSelect?.(p)); }, [ready, places, icons]);
  useEffect(() => {
    if (!ready) return;
    const maps = window.naver.maps;
    const visible = new Set();
    for (const officer of officers.filter(o => o.lat != null)) {
      visible.add(officer.id);
      let entry = officerMarkers.current.get(officer.id);
      if (!entry) {
        const marker = new maps.Marker({ map: mapRef.current, position: new maps.LatLng(officer.lat, officer.lng), zIndex: 200, title: officer.name,
          icon: { content: `<div class="officer-map-pin" data-officer-id="${officer.id}">${navigationIcon(officer.heading)}<small>${escapeHtml(officer.name)}</small></div>`, anchor: new maps.Point(20,20) } });
        entry = { marker, angle: officer.heading }; officerMarkers.current.set(officer.id, entry);
      }
      entry.marker.setPosition(new maps.LatLng(officer.lat, officer.lng));
      entry.marker.setTitle(officer.name);
      const node = container.current.querySelector(`[data-officer-id="${officer.id}"]`);
      if (node) {
        const known = Number.isFinite(officer.heading);
        const pin = node.querySelector('.user-location-pin');
        pin.classList.toggle('heading-unknown', !known);
        pin.setAttribute('aria-label', `${officer.name} · ${known ? Math.round(officer.heading)+'도' : '방향 정보 대기'}`);
        if (known) entry.angle = turnTo(entry.angle, officer.heading);
        node.querySelector('.user-heading-arrow').style.transform = `rotate(${known ? entry.angle : 0}deg)`;
        node.querySelector('small').textContent = officer.name + (officer.source === 'demo' ? ' · 데모' : '');
      }
    }
    for (const [id,entry] of officerMarkers.current) if (!visible.has(id)) { entry.marker.setMap(null); officerMarkers.current.delete(id); }
  }, [ready, officers]);
  useEffect(() => () => { for (const entry of officerMarkers.current.values()) entry.marker.setMap(null); officerMarkers.current.clear(); }, [ready]);
  useEffect(() => { if (ready && selected?.lat != null) mapRef.current.setCenter(new window.naver.maps.LatLng(selected.lat, selected.lng)); }, [ready, selected]);
  useEffect(() => {
    if (!ready || selected?.id || !selected?.address || selected.lat == null) return;
    const maps = window.naver.maps;
    const marker = new maps.Marker({ map: mapRef.current, position: new maps.LatLng(selected.lat, selected.lng), title: '선택한 주소 · 저장 전' });
    return () => marker.setMap(null);
  }, [ready, selected]);
  useEffect(() => {
    if (!ready || !history?.points?.length) return;
    const maps = window.naver.maps;
    const path = history.points.map(p => new maps.LatLng(p.lat, p.lng));
    const line = new maps.Polyline({ map: mapRef.current, path, strokeColor: '#2878e8', strokeWeight: 5, clickable: false });
    if (path.length > 1) { const bounds = new maps.LatLngBounds(path[0], path[0]); path.forEach(p => bounds.extend(p)); mapRef.current.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 }); }
    else mapRef.current.setCenter(path[0]);
    const endpoints = [new maps.Marker({map:mapRef.current,position:path[0],title:'순찰 시작',icon:{content:'<div class="history-endpoint">시작</div>',anchor:new maps.Point(22,15)}})];
    if (history.ended_at) endpoints.push(new maps.Marker({map:mapRef.current,position:path[path.length-1],title:'순찰 종료',icon:{content:'<div class="history-endpoint end">종료</div>',anchor:new maps.Point(22,15)}}));
    return () => { line.setMap(null); endpoints.forEach(marker=>marker.setMap(null)); };
  }, [ready, history]);
  return <div className="managed-map"><div className="managed-map-canvas" ref={container} />{error && <p className="managed-map-error" role="alert">{error}</p>}</div>;
}
