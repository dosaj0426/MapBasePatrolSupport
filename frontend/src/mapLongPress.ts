import {bindLongPress} from './longPress';
import type {MapInstance, NaverMaps} from './naverTypes';
import type {Coordinates} from './types';

export function bindMapLongPress(element: HTMLElement, map: MapInstance, maps: NaverMaps, move: (point: Coordinates) => void, delay = 1000) {
  let target: Coordinates | null = null;
  // Native capture starts the timer; the SDK then resolves its own touch coordinates.
  const gesture = bindLongPress(element, () => {
    target = null;
    return () => { if(target)move(target); target=null; };
  }, delay);
  const listeners = [
    maps.Event.addListener(map,'touchstart',event=>{
      const point=event.coord ?? event.latlng;
      target=point ? {lat:point.lat(),lng:point.lng()} : null;
    }),
    ...['zoomstart','zoom_changed','pinchstart','resize'].map(name=>maps.Event.addListener(map,name,()=>{target=null;gesture.cancel();})),
  ];
  return ()=>{gesture();listeners.forEach(listener=>maps.Event.removeListener(listener));target=null;};
}
