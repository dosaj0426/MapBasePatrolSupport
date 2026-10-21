import type { Officer, Place, Icon, Patrol, PatrolDetail, Alert, Address } from './types';
export function api(path: '/officers', options?: RequestInit): Promise<Officer[]>;
export function api(path: '/places', options?: RequestInit): Promise<Place[]>;
export function api(path: '/icons', options?: RequestInit): Promise<Icon[]>;
export function api(path: `/officers/${number}`, options?: RequestInit): Promise<Officer>;
export function api(path: `/patrols/${number}`, options?: RequestInit): Promise<PatrolDetail>;
export function api<T = unknown>(path: string, options?: RequestInit): Promise<T>;
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  let response;
  try { response = await fetch('/api' + path, { ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers } }); }
  catch { throw new Error('서버에 연결할 수 없습니다. 서버 구동기에서 백엔드가 실행 중인지 확인해 주세요.'); }
  const data = await response.json().catch(() => null);
  if (response.status === 401 && !['/access/exchange','/session'].includes(path)) window.dispatchEvent(new Event('patrol-access-expired'));
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : response.status >= 500 ? '서버 처리에 실패했습니다. 백엔드 실행 상태와 설정을 확인해 주세요.' : `요청 실패 (${response.status})`);
  return data;
}
export const jsonBody = (data: unknown) => JSON.stringify(data);
