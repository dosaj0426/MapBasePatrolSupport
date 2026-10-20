import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeading, turnTo, bearingBetween, compassHeading, navigationIcon } from './heading.js';
const origin={lat:35.16,lng:129.05};
test('동서남북 이동 방향을 계산한다',()=>{
  for (const [point,expected] of [[{lat:35.17,lng:129.05},0],[{lat:35.16,lng:129.06},90],[{lat:35.15,lng:129.05},180],[{lat:35.16,lng:129.04},270]]) {
    assert.ok(Math.abs(bearingBetween(origin,point)-expected)<.1);
  }
});
test('정지하거나 GPS가 작게 흔들릴 때 방향을 새로 만들지 않는다',()=>{
  assert.equal(bearingBetween(origin,origin),null);
  assert.equal(bearingBetween(origin,{lat:35.160001,lng:129.05},5),null);
});
test('북쪽 경계를 지날 때 358도 반대로 회전하지 않는다',()=>{
  assert.equal(turnTo(359,1),361); assert.equal(turnTo(1,359),-1);
  assert.equal(turnTo(null,90),90); assert.equal(normalizeHeading(-90),270);
});
test('나침반과 절대 방향만 사용하고 상대 회전·무효 센서는 제외한다',()=>{
  assert.equal(compassHeading({webkitCompassHeading:0,webkitCompassAccuracy:10}),0);
  assert.equal(compassHeading({webkitCompassHeading:90},90),180);
  assert.equal(compassHeading({webkitCompassHeading:10,webkitCompassAccuracy:-1}),null);
  assert.equal(compassHeading({absolute:true,alpha:90}),270);
  assert.equal(compassHeading({absolute:false,alpha:90}),null);
  assert.equal(compassHeading({absolute:true,alpha:null}),null);
});
test('방향이 없으면 대기 화살표, 있으면 해당 각도의 화살표를 만든다',()=>{
  assert.match(navigationIcon(null),/heading-unknown/);
  assert.match(navigationIcon(90),/rotate\(90deg\)/);
  assert.doesNotMatch(navigationIcon(90),/heading-unknown/);
});
