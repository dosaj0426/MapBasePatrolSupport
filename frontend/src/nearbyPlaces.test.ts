import test from 'node:test';
import assert from 'node:assert/strict';
import type { Place } from './types';
import { nearbyPlaces } from './nearbyPlaces';
const place = (id: number, lat: number): Place => ({id,lat,lng:129,name:`지점 ${id}`,category:'테스트',address:'테스트 주소',postal_code:'',detail:'',icon_id:null,enhanced:false,radius:50,multiplier:1.5,message:'',alert_type:'info',revision:1});
test('지도 중심이 바뀌면 가까운 지점 순서가 바뀌며 원본은 유지한다',()=>{
  const original = [place(1,35),place(2,35.01),place(3,35.02)];
  assert.deepEqual(nearbyPlaces(original,{lat:35,lng:129}).map(x=>x.place.id),[1,2,3]);
  assert.deepEqual(nearbyPlaces(original,{lat:35.02,lng:129}).map(x=>x.place.id),[3,2,1]);
  assert.deepEqual(original.map(x=>x.id),[1,2,3]);
  assert.deepEqual(nearbyPlaces([place(2,35),place(1,35)],{lat:35,lng:129}).map(x=>x.place.id),[1,2]);
});
