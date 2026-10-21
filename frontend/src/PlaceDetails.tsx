import type { Place, Icon, InspectionRecord } from './types';
import { getNotificationType } from './notificationTypes';
const time = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
export default function PlaceDetails({place, icon, records, loading, error, onBack, onEdit, onDelete, onPatrol}: {
  place: Place; icon?: Icon; records: InspectionRecord[]; loading: boolean; error: string;
  onBack: () => void; onEdit: () => void; onDelete: () => void; onPatrol: (id: number) => void;
}) {
  return <>
    <button className="history-back" onClick={onBack}>← 지점 목록으로</button>
    <div className="place-detail-title">{icon && <img src={icon.url} alt=""/>}<div><p>LOCATION DETAILS</p><h1>{place.name}</h1><span>{place.category}</span></div></div>
    <div className="place-detail-actions"><button className="admin-primary" onClick={onEdit}>정보 수정</button><button className="admin-danger" onClick={onDelete}>지점 삭제</button></div>
    <dl className="place-detail-info"><dt>주소</dt><dd>{place.address}<br/>{place.detail || '상세 주소 없음'}</dd><dt>우편번호</dt><dd>{place.postal_code || '미등록'}</dd><dt>강화구역</dt><dd>{place.enhanced ? '사용 중' : '미사용'}</dd>{place.enhanced && <><dt>진입 범위</dt><dd>반지름 {place.radius}m</dd><dt>완충 범위</dt><dd>{Math.round(place.radius*place.multiplier)}m ({place.multiplier}배)</dd><dt>알림 타입</dt><dd>{getNotificationType(place.alert_type).label}</dd><dt>음성 안내</dt><dd>{place.message || `${place.name} 범죄예방 강화구역입니다. 주변을 확인해 주세요.`}</dd></>}</dl>
    <h2 className="admin-list-title">과거 점검 기록</h2>
    <p className="admin-hint">종료된 최근 순찰 200건에서 확인한 강화구역 진입 기록입니다. 현장 점검 완료 여부나 점검표를 의미하지 않습니다.</p>
    {loading ? <p role="status">기록을 불러오는 중입니다.</p> : error ? <p role="alert">{error}</p> : <>
      <p className="place-record-count">방문 순찰 {records.length}건 · 총 진입 {records.reduce((sum,r)=>sum+r.entry_count,0)}회</p>
      {records.map(record=><button className="admin-history-card" key={record.patrol_id} onClick={()=>onPatrol(record.patrol_id)}><strong>{record.officer_name} · 순찰 #{record.patrol_id}</strong><span>진입 {record.entry_count}회 · 추정 체류 {Math.floor(record.dwell_seconds/60)}분 {Math.floor(record.dwell_seconds%60)}초</span><small>최근 진입 {time(record.last_entry_at)}</small><small>{record.source==='demo'?'데모 시작 · ':''}{record.legacy?'현재 설정 기준 참고 기록':'종료 확정 기록'} · 경로·상세 결과 보기 →</small></button>)}
      {!records.length && <p className="admin-empty">저장된 순찰 방문 기록이 없습니다.</p>}
    </>}
  </>;
}
