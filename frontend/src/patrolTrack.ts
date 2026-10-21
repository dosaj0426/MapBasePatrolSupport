import type { Coordinates, RoutePoint, LocationSource } from './types';
export function distanceMeters(a: Coordinates, b: Coordinates) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export class PatrolTrack {
  active = false;
  points: RoutePoint[] = [];
  start(position: Coordinates, time = Date.now()) {
    this.active = true;
    this.points = [{ ...position, time, source: 'start' }];
  }
  record(position: Coordinates, source: LocationSource = 'demo', time = Date.now(), accuracy = 0) {
    if (!this.active || !Number.isFinite(position.lat) || !Number.isFinite(position.lng) || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) return false;
    const last = this.points.at(-1);
    if (!last) return false;
    const distance = distanceMeters(last, position);
    if (distance < .01) return false;
    // GPS만 필터링한다. Shift 클릭 및 방향키 데모는 거리와 무관하게 기록한다.
    if (source === 'gps') {
      if (accuracy > 100 || distance < 3) return false;
      if (last.source === 'gps' && (time <= last.time || distance / ((time - last.time) / 1000) > 70)) return false;
    }
    this.points.push({ ...position, time, source });
    return true;
  }
  stop() { this.active = false; }
}
