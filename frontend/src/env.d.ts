/// <reference types="vite/client" />
// Naver Maps is loaded by a script; declare its browser namespace.
interface Window {
  naver: { maps: import('./naverTypes').NaverMaps };
  __patrolMapReady?: () => void;
  navermap_authFailure?: () => void;
  webkitAudioContext?: typeof AudioContext;
  orientation?: number;
}
interface DeviceOrientationEventConstructor {
  requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'>;
}
