import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatrolTrack } from './patrolTrack';
import { moveTenMeters } from './location';
const origin = { lat: 35.1602002, lng: 129.054338 };

test('시작 전·종료 후에는 기록하지 않고 다음 시작 시 초기화', () => {
  const track = new PatrolTrack();
  const next = moveTenMeters(origin, 'ArrowUp');
  assert.equal(track.record(next), false);
  track.start(origin, 0);
  assert.equal(track.record(next, 'demo', 1000), true);
  track.stop();
  assert.equal(track.record(origin), false);
  assert.equal(track.points.length, 2);
  track.start(next, 2000);
  assert.equal(track.points.length, 1);
});
test('Shift 클릭 순간이동도 연결하고 중복 좌표는 제외', () => {
  const track = new PatrolTrack(); track.start(origin, 0);
  assert.equal(track.record({ lat: 35.2, lng: 129.1 }, 'demo', 1), true);
  assert.equal(track.record({ lat: 35.2, lng: 129.1 }, 'demo', 2), false);
});
test('GPS 작은 흔들림·낮은 정확도·비정상 속도 제외', () => {
  const track = new PatrolTrack(); track.start(origin, 0);
  const next = moveTenMeters(origin, 'ArrowUp');
  assert.equal(track.record(next, 'gps', 1000, 200), false);
  assert.equal(track.record(next, 'gps', 1000, 10), true);
  assert.equal(track.record({ lat: 35.3, lng: 129.2 }, 'gps', 2000, 10), false);
  assert.equal(track.record({ lat: NaN, lng: 129 }, 'demo', 3000), false);
});
