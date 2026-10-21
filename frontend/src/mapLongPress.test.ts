import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMapLongPress} from './mapLongPress';
import type {MapClickEvent, MapInstance, NaverMaps} from './naverTypes';
import type {Coordinates} from './types';

test('long hold uses SDK coordinates at each zoom and cancels changed zoom or missing coordinates',async()=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
  const element=new EventTarget() as HTMLElement;
  const listeners=new Map<string,(event:MapClickEvent)=>void>();
  const maps={Event:{addListener(_map:object,name:string,callback:(event:MapClickEvent)=>void){listeners.set(name,callback);return {name};},removeListener(handle:{name:string}){listeners.delete(handle.name);}}} as unknown as NaverMaps;
  const moved:Coordinates[]=[];
  const map={getProjection(){throw new Error('Manual pixel conversion must not be used');}} as unknown as MapInstance;
  const dispose=bindMapLongPress(element,map,maps,p=>moved.push(p),10);
  function start(point?:Coordinates){
    const event=new Event('touchstart');
    Object.defineProperty(event,'touches',{value:[{identifier:1,clientX:150,clientY:250}]});
    element.dispatchEvent(event);
    listeners.get('touchstart')?.(point?{coord:{lat:()=>point.lat,lng:()=>point.lng}}:{});
  }
  const wait=()=>new Promise(resolve=>setTimeout(resolve,25));
  try {
    const wide={lat:35.16,lng:129.05}, zoomed={lat:35.16001,lng:129.05002};
    start(wide);await wait();start(zoomed);await wait();
    assert.deepEqual(moved,[wide,zoomed]);
    start(wide);listeners.get('zoom_changed')?.({});await wait();
    start();await wait();
    assert.equal(moved.length,2,'zooming or missing SDK coordinates must never reuse a previous target');
    start(wide);dispose();await wait();assert.equal(moved.length,2);
    assert.equal(listeners.size,0);
  }finally{
    dispose();if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window');
  }
});
