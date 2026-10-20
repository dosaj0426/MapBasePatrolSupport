import { useEffect, useRef, useState } from 'react';
import { bearingBetween, compassHeading, turnTo } from './heading.js';

export default function useHeading(mode) {
  const [heading, setHeading] = useState(null), [source, setSource] = useState('대기');
  const [sensorStatus, setSensorStatus] = useState('방향 센서 켜기');
  const currentMode = useRef(mode), compass = useRef(null), gpsAnchor = useRef(null), listening = useRef(false), dispose = useRef(null);
  currentMode.current = mode;
  function update(value, label, smooth = false) {
    if (!Number.isFinite(value)) return;
    setHeading(previous => {
      const target = turnTo(previous, value);
      return smooth && Number.isFinite(previous) ? previous + (target - previous) * .35 : target;
    });
    setSource(label);
  }
  function attach() {
    if (listening.current) return;
    listening.current = true;
    function receive(event) {
      const angle = window.screen.orientation?.angle ?? window.orientation ?? 0;
      const value = compassHeading(event, Number(angle) || 0);
      if (value === null) return;
      compass.current = { value, time: Date.now() };
      setSensorStatus('방향 센서 사용 중');
      if (currentMode.current === 'gps') update(value, '기기 방향', true);
    }
    window.addEventListener('deviceorientationabsolute', receive);
    window.addEventListener('deviceorientation', receive);
    dispose.current = () => { window.removeEventListener('deviceorientationabsolute', receive); window.removeEventListener('deviceorientation', receive); listening.current = false; };
    setSensorStatus('방향 센서 수신 대기');
  }
  async function enableSensor() {
    if (!window.isSecureContext || !window.DeviceOrientationEvent) { setSensorStatus('센서 미지원 · 이동 방향 사용'); return; }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const result = await DeviceOrientationEvent.requestPermission(true);
        if (result !== 'granted') { setSensorStatus('센서 권한 거부 · 이동 방향 사용'); return; }
      }
      attach();
    } catch { setSensorStatus('센서 사용 불가 · 이동 방향 사용'); }
  }
  useEffect(() => {
    let requested = false;
    function activate() {
      if (requested) return;
      requested = true;
      enableSensor();
    }
    if (window.isSecureContext && window.DeviceOrientationEvent) {
      if (typeof DeviceOrientationEvent.requestPermission !== 'function') attach();
      else {
        window.addEventListener('pointerup', activate, true);
        window.addEventListener('keydown', activate, true);
      }
    } else setSensorStatus('센서 미지원 · 이동 방향 사용');
    return () => {
      window.removeEventListener('pointerup', activate, true);
      window.removeEventListener('keydown', activate, true);
      dispose.current?.();
    };
  }, []);
  function positionChanged(previous, next, data) {
    if (data.source !== 'gps') { gpsAnchor.current = null; update(bearingBetween(previous, next, .1), '데모 이동 방향'); return; }
    if (compass.current && Date.now() - compass.current.time < 2500) { update(compass.current.value, '기기 방향', true); return; }
    if (data.accuracy > 100) return;
    if (Number.isFinite(data.heading) && data.heading >= 0 && data.speed >= .5) { update(data.heading, 'GPS 이동 방향'); gpsAnchor.current = next; return; }
    const anchor = gpsAnchor.current;
    if (!anchor) { gpsAnchor.current = next; return; }
    const value = bearingBetween(anchor, next, Math.max(5, Math.min(20, data.accuracy / 2)));
    if (value !== null) { update(value, 'GPS 이동 방향'); gpsAnchor.current = next; }
  }
  return { heading, source, sensorStatus, enableSensor, positionChanged };
}
