import type { RefObject } from 'react';
import type { Officer, Coordinates, Notification, HeadingSample, HeadingSource, PositionSample, Patrol, PatrolDetail, RestoredPatrol, LocationSource, Alert } from './types';
import type { PatrolTrack } from './patrolTrack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, jsonBody } from './api';

export default function usePatrolServer(officerId: number, track: RefObject<PatrolTrack>, onAlert: (item: Notification) => void) {
  const [officer, setOfficer] = useState<Officer | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const remote = useRef<{id: number | null; ack: number; source: LocationSource; uploading: Promise<void> | null}>({ id: null, ack: -1, source: 'demo', uploading: null });
  const live = useRef<PositionSample | null>(null), positionQueue = useRef<PositionSample[]>([]), alertCursor = useRef(0), alertHandler = useRef(onAlert);
  alertHandler.current = onAlert;
  const [restore, setRestore] = useState<RestoredPatrol | null>(null);
  const pendingHeading = useRef<HeadingSample | null>(null);
  const reportHeading = useCallback((heading: number | null, source: HeadingSource) => {
    pendingHeading.current = { heading, source, measured_at: new Date().toISOString() };
  }, []);
  useEffect(() => {
    if (!officer) return;
    let sending = false, last: HeadingSample | null = null, sentAt = 0, disposed = false;
    async function send() {
      const next = pendingHeading.current;
      if (!next || sending || disposed) return;
      const angleChanged = next.heading !== null && Number.isFinite(next.heading) && (!Number.isFinite(last?.heading) || Math.abs(((next.heading-last!.heading!+540)%360)-180) >= 1);
      if (last && !angleChanged && next.source === last.source && (next.heading === null) === (last.heading === null) && Date.now()-sentAt < 5000) return;
      sending = true;
      try {
        const sample = { ...next, measured_at: new Date().toISOString() };
        await api(`/officers/${officerId}/heading`, { method: 'POST', body: jsonBody(sample) });
        last = next; sentAt = Date.now();
      } catch { if (!disposed) setError('방향 정보를 전송하지 못했습니다. 연결 후 자동 재시도합니다.'); }
      finally { sending = false; }
    }
    send(); const timer = setInterval(send, 250);
    return () => { disposed = true; clearInterval(timer); };
  }, [officer, officerId]);
  useEffect(() => {
    let disposed = false;
    async function initialize() {
      try {
        const data = await api(`/officers/${officerId}`);
        if (disposed) return;
        setOfficer(data);
        if (data.active_patrol_id) {
          const saved = await api(`/patrols/${data.active_patrol_id}`);
          if (disposed) return;
          remote.current = { id: saved.id, ack: saved.points.length - 1, source: saved.source, uploading: null };
          const points = saved.points.map(p => ({ lat: p.lat, lng: p.lng, time: Date.parse(p.measured_at), source: p.source }));
          if (points.length) setRestore({ ...saved, points });
          else setRestore({ ...saved, points: [] });
        }
      } catch(e) { if (!disposed) setError(e.message); }
    }
    initialize();
    return () => { disposed = true; };
  }, [officerId]);

  const reportPosition = useCallback((position: Coordinates, source: LocationSource, accuracy = 0) => {
    const sample: PositionSample = { ...position, source: source === 'gps' ? 'gps' : 'demo', accuracy, measured_at: new Date().toISOString() };
    live.current = sample;
    positionQueue.current.push(sample);
    if (positionQueue.current.length > 1000) positionQueue.current.shift();
  }, []);

  const flushRoute = useCallback(async () => {
    if (remote.current.uploading) return remote.current.uploading;
    const promise = (async () => {
      const state = remote.current;
      if (!state.id) return;
      while (state.ack + 1 < track.current.points.length) {
        const points = track.current.points.slice(state.ack + 1, state.ack + 501).map((p, i) => ({ lat: p.lat, lng: p.lng, sequence: state.ack + 1 + i, measured_at: new Date(p.time).toISOString(), source: p.source === 'start' ? state.source : p.source }));
        const result = await api<{last_sequence: number}>(`/officers/${officerId}/patrols/${state.id}/points`, { method: 'POST', body: jsonBody({ points }) });
        state.ack = result.last_sequence;
      }
    })();
    remote.current.uploading = promise;
    try { await promise; } finally { remote.current.uploading = null; }
  }, [officerId, track]);

  useEffect(() => {
    if (!officer) return;
    let disposed = false, running = false;
    async function tick() {
      if (running) return; running = true;
      try {
        if (!positionQueue.current.length && live.current) positionQueue.current.push({ ...live.current, measured_at: new Date().toISOString() });
        while (positionQueue.current.length && !disposed) {
          const sample = positionQueue.current[0];
          await api(`/officers/${officerId}/location`, { method: 'POST', body: jsonBody(sample) });
          positionQueue.current.shift();
        }
        await flushRoute();
        const alerts = await api<Alert[]>(`/officers/${officerId}/alerts?after=${alertCursor.current}`);
        for (const alert of alerts) {
          if (disposed) break;
          alertCursor.current = Math.max(alertCursor.current, alert.id);
          alertHandler.current({ ...alert, id: `server-${alert.id}`, serverId: alert.id, time: new Date(alert.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });
        }
        if (!disposed) setError('');
      } catch(e) { if (!disposed) setError(`서버 연결: ${e.message} · 미전송 경로는 화면에 보관하고 재시도합니다.`); }
      finally { running = false; }
    }
    tick(); const timer = setInterval(tick, 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [officer, officerId, flushRoute]);

  async function start(source: LocationSource) {
    setBusy(true);
    try {
      const result = await api<Patrol>(`/officers/${officerId}/patrols`, { method: 'POST', body: jsonBody({ source }) });
      remote.current = { id: result.id, ack: -1, source, uploading: null };
      return result;
    } finally { setBusy(false); }
  }
  async function end() {
    setBusy(true);
    try {
      await flushRoute();
      await api(`/officers/${officerId}/patrols/${remote.current.id}/end`, { method: 'POST', body: jsonBody({ last_sequence: track.current.points.length - 1 }) });
      remote.current.id = null;
    } finally { setBusy(false); }
  }
  async function markRead(id: number) {
    await api(`/officers/${officerId}/alerts/${id}/read`, { method: 'POST' });
  }
  return { officer, error, busy, start, end, reportPosition, reportHeading, restore, markRead, setError };
}
