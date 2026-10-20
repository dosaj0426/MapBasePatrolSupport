export async function api(path, options = {}) {
  let response;
  try { response = await fetch('/api' + path, { ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers } }); }
  catch { throw new Error('서버에 연결할 수 없습니다. 서버 구동기에서 백엔드가 실행 중인지 확인해 주세요.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : response.status >= 500 ? '서버 처리에 실패했습니다. 백엔드 실행 상태와 설정을 확인해 주세요.' : `요청 실패 (${response.status})`);
  return data;
}
export const jsonBody = data => JSON.stringify(data);
