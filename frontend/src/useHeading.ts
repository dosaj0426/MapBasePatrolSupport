import type { Coordinates, LocationSource, HeadingSample } from './types';
import { useEffect, useRef, useState } from 'react';
import { bearingBetween, compassHeading, turnTo, normalizeHeading } from './heading';

export default function useHeading(mode: LocationSource, keepCompassInDemo = false) {
  const [heading, setHeading] = useState<number | null>(null), [source, setSource] = useState('대기');
  const currentHeading = useRef<number | null>(null), sample = useRef<HeadingSample | null>(null);
  const [measuredAt,setMeasuredAt] = useState<string | null>(null);
  const [sensorStatus, setSensorStatus] = useState('방향 센서 켜기');
  const currentMode = useRef(mode), compass = useRef<{value: number; time: number} | null>(null), gpsAnchor = useRef<Coordinates | null>(null), listening = useRef(false), dispose = useRef<(() => void) | null>(null);
  currentMode.current = mode;
  const compassInDemo = useRef(keepCompassInDemo);
  compassInDemo.current = keepCompassInDemo;
  function update(value: number | null, label: string, smooth = false) {
    if (value === null || !Number.isFinite(value)) return;
    const previous = currentHeading.current;
    const target = turnTo(previous,value);
    const next = smooth && previous !== null ? previous+(target-previous)*.35 : target;
    currentHeading.current=next;
    const time=new Date().toISOString();
    const source = label==='기기 방향'?'sensor':label==='데모 이동 방향'?'demo':'gps';
    sample.current={heading:normalizeHeading(next),source,measured_at:time};
    setHeading(next);setSource(label);setMeasuredAt(time);
    return sample.current;
  }
  function attach() {
    if (listening.current) return;
    listening.current = true;
    function receive(event: DeviceOrientationEvent) {
      const angle = window.screen.orientation?.angle ?? window.orientation ?? 0;
      const value = compassHeading(event, Number(angle) || 0);
      if (value === null) return;
      compass.current = { value, time: Date.now() };
      setSensorStatus('방향 센서 사용 중');
      if (currentMode.current === 'gps' || compassInDemo.current) update(value, '기기 방향', true);
    }
    window.addEventListener('deviceorientationabsolute', receive);
    window.addEventListener('deviceorientation', receive);
    dispose.current = () => { window.removeEventListener('deviceorientationabsolute', receive); window.removeEventListener('deviceorientation', receive); listening.current = false; };
    setSensorStatus('방향 센서 수신 대기');
  }
  async function enableSensor() {
    if (!window.isSecureContext || !window.DeviceOrientationEvent) { setSensorStatus('센서 미지원 · 이동 방향 사용'); return; }
    try {
      if (typeof (DeviceOrientationEvent as typeof DeviceOrientationEvent & DeviceOrientationEventConstructor).requestPermission === 'function') {
        const result = await (DeviceOrientationEvent as typeof DeviceOrientationEvent & DeviceOrientationEventConstructor).requestPermission!(true);
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
      if (typeof (DeviceOrientationEvent as typeof DeviceOrientationEvent & DeviceOrientationEventConstructor).requestPermission !== 'function') attach();
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
  function positionChanged(previous: Coordinates, next: Coordinates, data: {source: LocationSource; accuracy: number; heading?: number | null; speed?: number | null}) {
    if (data.source !== 'gps') {
      gpsAnchor.current = null;
      if (compassInDemo.current && compass.current && Date.now() - compass.current.time < 2500) return update(compass.current.value, '기기 방향', true);
      return update(bearingBetween(previous, next, .1), '데모 이동 방향') ?? sample.current;
    }
    if (compass.current && Date.now() - compass.current.time < 2500) { return update(compass.current.value, '기기 방향', true); }
    if (data.accuracy > 100) return sample.current;
    if (Number.isFinite(data.heading) && data.heading! >= 0 && (data.speed ?? 0) >= .5) { gpsAnchor.current = next; return update(data.heading ?? null, 'GPS 이동 방향'); }
    const anchor = gpsAnchor.current;
    if (!anchor) { gpsAnchor.current = next; return sample.current; }
    const value = bearingBetween(anchor, next, Math.max(5, Math.min(20, data.accuracy / 2)));
    if (value !== null) { gpsAnchor.current = next; return update(value, 'GPS 이동 방향'); }
    return sample.current;
  }
  return { heading, source, measuredAt, sensorStatus, enableSensor, positionChanged };
}
