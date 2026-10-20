import { distanceMeters } from './patrolTrack.js';
export const normalizeHeading = angle => ((angle % 360) + 360) % 360;
export function turnTo(previous, next) {
  if (!Number.isFinite(previous)) return normalizeHeading(next);
  return previous + ((normalizeHeading(next) - normalizeHeading(previous) + 540) % 360) - 180;
}
export function bearingBetween(a, b, minimum = 3) {
  if (distanceMeters(a, b) < minimum) return null;
  const rad = Math.PI / 180, lat1 = a.lat * rad, lat2 = b.lat * rad, delta = (b.lng - a.lng) * rad;
  return normalizeHeading(Math.atan2(Math.sin(delta) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta)) / rad);
}
export function compassHeading(event, screenAngle = 0) {
  if (Number.isFinite(event.webkitCompassHeading) && event.webkitCompassHeading >= 0 &&
      (!Number.isFinite(event.webkitCompassAccuracy) || (event.webkitCompassAccuracy >= 0 && event.webkitCompassAccuracy <= 50))) {
    return normalizeHeading(event.webkitCompassHeading + screenAngle);
  }
  if (event.absolute === true && Number.isFinite(event.alpha)) return normalizeHeading(360 - event.alpha + screenAngle);
  return null; // 상대 자이로 회전을 북쪽 기준 방향으로 오인하지 않는다.
}
export function navigationIcon(angle) {
  const known = Number.isFinite(angle);
  return `<div class="user-location-pin${known ? '' : ' heading-unknown'}" role="img" aria-label="${known ? '내 방향 ' + Math.round(normalizeHeading(angle)) + '도' : '내 위치 · 방향 정보 대기'}"><svg class="user-heading-arrow" style="transform:rotate(${known ? angle : 0}deg)" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4L33 33L20 27L7 33Z" fill="currentColor" stroke="white" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 8V26L10 30Z" fill="white" opacity=".2"/></svg></div>`;
}
