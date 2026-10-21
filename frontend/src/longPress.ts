/** Capture native touch events before the map SDK handles the gesture. */
export function bindLongPress(element: HTMLElement, prepare: (x: number, y: number) => () => void, delay = 1000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: {id: number; x: number; y: number} | undefined;
  function cancel() { clearTimeout(timer); timer = undefined; start = undefined; }
  function begin(event: TouchEvent) {
    cancel();
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    start = {id: touch.identifier, x: touch.clientX, y: touch.clientY};
    // Resolve the geographic target at touch-down, before SDK panning/animation changes it.
    const commit = prepare(start.x, start.y);
    timer = setTimeout(() => { timer = undefined; start = undefined; commit(); }, delay);
  }
  function update(event: TouchEvent) {
    if (!start) return;
    const touch = Array.from(event.touches).find(item => item.identifier === start!.id);
    if (event.touches.length !== 1 || !touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 12) cancel();
  }
  function context(event: Event) { event.preventDefault(); }
  const options = {capture: true, passive: true};
  element.addEventListener('touchstart', begin, options);
  element.addEventListener('touchmove', update, options);
  element.addEventListener('touchend', cancel, options);
  element.addEventListener('touchcancel', cancel, options);
  element.addEventListener('contextmenu', context, true);
  window.addEventListener('blur', cancel);
  const dispose = () => {
    cancel();
    element.removeEventListener('touchstart', begin, true);
    element.removeEventListener('touchmove', update, true);
    element.removeEventListener('touchend', cancel, true);
    element.removeEventListener('touchcancel', cancel, true);
    element.removeEventListener('contextmenu', context, true);
    window.removeEventListener('blur', cancel);
  };
  return Object.assign(dispose, {cancel});
}
