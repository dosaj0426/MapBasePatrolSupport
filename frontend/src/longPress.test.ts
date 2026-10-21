import test from 'node:test';
import assert from 'node:assert/strict';
import {bindLongPress} from './longPress';

test('native long press: hold, jitter, release, drag, multi-touch and cleanup', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {value: new EventTarget(), configurable: true});
  const element = new EventTarget() as HTMLElement;
  const moves: number[][] = [];
  const touch = (x: number, y = 20, identifier = 1) => ({clientX:x, clientY:y, identifier});
  function send(name: string, touches: ReturnType<typeof touch>[]) {
    const event = new Event(name);
    Object.defineProperty(event, 'touches', {value: touches});
    element.dispatchEvent(event);
  }
  const wait = () => new Promise(resolve => setTimeout(resolve, 35));
  let mapOffset = 0;
  const cleanup = bindLongPress(element, (x,y) => {
    const target = [x + mapOffset,y];
    return () => { moves.push(target); };
  }, 15);
  try {
    send('touchstart',[touch(10)]); send('touchmove',[touch(15)]);
    mapOffset = 500;
    await wait();
    assert.deepEqual(moves, [[10,20]], 'small finger jitter still moves at initial touch');
    send('touchend',[]); await wait(); assert.equal(moves.length,1, 'one move per gesture');
    send('touchstart',[touch(10)]); send('touchend',[]); await wait();
    assert.equal(moves.length,1,'short tap ignored');
    send('touchstart',[touch(10)]); send('touchmove',[touch(40)]); await wait();
    assert.equal(moves.length,1,'drag cancels');
    send('touchstart',[touch(10)]); send('touchstart',[touch(10),touch(50,20,2)]); await wait();
    assert.equal(moves.length,1,'pinch cancels');
    send('touchstart',[touch(10)]); send('touchcancel',[]); await wait();
    assert.equal(moves.length,1,'browser cancellation respected');
    send('touchstart',[touch(10)]); cleanup(); await wait();
    assert.equal(moves.length,1,'disabled/unmounted gesture cancels');
  } finally {
    cleanup();
    if(previous)Object.defineProperty(globalThis,'window',previous);
    else Reflect.deleteProperty(globalThis,'window');
  }
});
