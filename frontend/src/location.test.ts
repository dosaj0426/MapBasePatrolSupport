import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moveTenMeters } from './location';

const origin = { lat: 35.1602002, lng: 129.054338 };
function distance(a: {lat: number; lng: number}, b: {lat: number; lng: number}) {
  const r = Math.PI / 180;
  const value = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(value));
}
for (const [key, axis, sign] of [['ArrowUp', 'lat', 1], ['ArrowDown', 'lat', -1], ['ArrowRight', 'lng', 1], ['ArrowLeft', 'lng', -1]] as const) {
  test(`${key}: 지정 방향으로 10m 이동`, () => {
    const next = moveTenMeters(origin, key);
    assert.ok((next[axis] - origin[axis]) * sign > 0);
    assert.ok(Math.abs(distance(origin, next) - 10) < 0.001);
    assert.deepEqual(origin, { lat: 35.1602002, lng: 129.054338 });
  });
}
test('지원하지 않는 키는 이동하지 않는다', () => assert.equal(moveTenMeters(origin, 'Enter'), origin));
