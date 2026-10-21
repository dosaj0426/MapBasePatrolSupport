import type { Officer } from './types';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import PatrolPage from './PatrolPage';
import AdminPage from './AdminPage';
import { api } from './api';
import AccessGate from './AccessGate';

class ScreenErrorBoundary extends React.Component<React.PropsWithChildren, {error: Error | null}> {
  state: {error: Error | null} = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('Screen rendering failed', error, info); }
  render() {
    if (this.state.error) return <main className="entry" role="alert"><h1>화면을 표시하지 못했습니다</h1><p>오류: {this.state.error.message || '알 수 없는 화면 오류'}</p><button onClick={() => window.location.reload()}>다시 불러오기</button><p><a href="/user">순찰자 선택으로 이동</a></p></main>;
    return this.props.children;
  }
}
function OfficerPicker() {
  const [officers, setOfficers] = useState<Officer[]>([]), [error, setError] = useState('');
  useEffect(() => { api('/officers').then(setOfficers).catch(e => setError(e.message)); }, []);
  return <main className="entry"><p className="eyebrow">SMART PATROL</p><h1>순찰자를 선택하세요</h1>{error && <p role="alert">{error}</p>}<nav className="entry-links">{officers.map(o=><a key={o.id} href={o.url}>{o.name} →</a>)}</nav>{!officers.length && <p>관리자 화면에서 순찰자를 먼저 생성해 주세요.</p>}<a href="/admin">관리자 화면으로 이동 →</a></main>;
}
function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') return <AdminPage/>;
  if (path === '/user') return <OfficerPicker/>;
  const match = path.match(/^\/user\/([1-9]\d*)$/);
  if (match) return <PatrolPage key={match[1]} officerId={Number(match[1])}/>;
  return <main className="entry"><p className="eyebrow">SMART PATROL</p><h1>{path === '/' ? '스마트 순찰 지원 시스템' : '페이지를 찾을 수 없습니다'}</h1><p>관리자는 지점과 순찰 기록을 관리합니다. 순찰자는 전용 링크로 접속합니다.</p><nav className="entry-links"><a href="/admin">관리자 화면 →</a><a href="/user">순찰자 선택 →</a></nav><p className="notice">발급된 접속 권한으로만 서비스를 이용할 수 있습니다.</p></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ScreenErrorBoundary><AccessGate><App/></AccessGate></ScreenErrorBoundary></React.StrictMode>);
