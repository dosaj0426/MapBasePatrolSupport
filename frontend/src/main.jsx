import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import PatrolPage from './PatrolPage.jsx';
import AdminPage from './AdminPage.jsx';
import { api } from './api.js';

class ScreenErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Screen rendering failed', error, info); }
  render() {
    if (this.state.error) return <main className="entry" role="alert"><h1>화면을 표시하지 못했습니다</h1><p>오류: {this.state.error.message || '알 수 없는 화면 오류'}</p><button onClick={() => window.location.reload()}>다시 불러오기</button><p><a href="/user">순찰자 선택으로 이동</a></p></main>;
    return this.props.children;
  }
}
function OfficerPicker() {
  const [officers, setOfficers] = useState([]), [error, setError] = useState('');
  useEffect(() => { api('/officers').then(setOfficers).catch(e => setError(e.message)); }, []);
  return <main className="entry"><p className="eyebrow">SMART PATROL</p><h1>순찰자를 선택하세요</h1>{error && <p role="alert">{error}</p>}<nav className="entry-links">{officers.map(o=><a key={o.id} href={o.url}>{o.name} →</a>)}</nav>{!officers.length && <p>관리자 화면에서 순찰자를 먼저 생성해 주세요.</p>}<a href="/admin">관리자 화면으로 이동 →</a></main>;
}
function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') return <AdminPage/>;
  if (path === '/user') return <OfficerPicker/>;
  const match = path.match(/^\/user\/([1-9]\d*)$/);
  if (match) return <PatrolPage key={match[1]} officerId={Number(match[1])}/>;
  return <main className="entry"><p className="eyebrow">SMART PATROL · DEVELOPMENT</p><h1>{path === '/' ? '스마트 순찰 지원 시스템' : '페이지를 찾을 수 없습니다'}</h1><p>관리자는 지점을 관리하고, 순찰자는 개별 접속 주소로 입장합니다.</p><nav className="entry-links"><a href="/admin">관리자 화면 →</a><a href="/user">순찰자 선택 →</a></nav><p className="notice">개발용 경로 구분 방식입니다. 실제 사용자 인증을 제공하지 않습니다.</p></main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ScreenErrorBoundary><App/></ScreenErrorBoundary></React.StrictMode>);
