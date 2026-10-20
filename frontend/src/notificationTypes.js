// 관리자 API는 색상이 아닌 type을 전송한다. 화면 색상·표시는 이 파일에서 관리한다.
export const NOTIFICATION_TYPES = {
  info: { label: '안내', accent: '#087c69', background: '#f0faf6', text: '#255148', badge: '#d9f0e7' },
  warning: { label: '주의', accent: '#a66509', background: '#fffbef', text: '#704d1d', badge: '#fcecc3' },
  danger: { label: '위험', accent: '#cb551b', background: '#fff5ed', text: '#893c1c', badge: '#ffe3ce' },
  emergency: { label: '긴급', accent: '#c93648', background: '#fff1f3', text: '#8f2736', badge: '#ffdae1' },
};

export function getNotificationType(type) {
  return Object.hasOwn(NOTIFICATION_TYPES, type) ? NOTIFICATION_TYPES[type] : NOTIFICATION_TYPES.info;
}
