// Structural types for the subset of the externally loaded SDK used by this app.
export interface LatLng { lat(): number; lng(): number }
export interface MapInstance {
  setCenter(point: LatLng): void;
  getCenter(): LatLng;
  getProjection(): {fromOffsetToCoord(point: object): LatLng};
  setSize(size: object): void;
  setZoom(zoom: number, animate?: boolean): void;
  getZoom(): number;
  fitBounds(bounds: Bounds, padding: {top: number; right: number; bottom: number; left: number}): void;
  refresh(force?: boolean): void;
  destroy(): void;
}
export interface Overlay { setMap(map: MapInstance | null): void }
export interface Marker extends Overlay { setPosition(point: LatLng): void; setTitle(title: string): void }
export interface Polyline extends Overlay { getPath(): {push(point: LatLng): void} }
export interface Bounds { extend(point: LatLng): void }
export interface MapClickEvent { pointerEvent?: MouseEvent & {touches?: TouchList; originalEvent?: MouseEvent & {touches?: TouchList}}; coord?: LatLng; latlng?: LatLng }
export interface NaverMaps {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  LatLng: new (lat: number, lng: number) => LatLng;
  Point: new (x: number, y: number) => object;
  Size: new (width: number, height: number) => object;
  Marker: new (options: Record<string, unknown>) => Marker;
  Circle: new (options: Record<string, unknown>) => Overlay;
  Polyline: new (options: Record<string, unknown>) => Polyline;
  LatLngBounds: new (southwest: LatLng, northeast: LatLng) => Bounds;
  Event: {
    addListener(target: object, name: string, listener: (event: MapClickEvent) => void): object;
    removeListener(handle: object): void;
    clearInstanceListeners(target: object): void;
  };
}
