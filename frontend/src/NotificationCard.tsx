import type { Notification } from './types';
import React from 'react';
import { getNotificationType } from './notificationTypes';

export default function NotificationCard({ item, onRead }: { item: Notification; onRead: (id: Notification['id']) => void }) {
  const theme = getNotificationType(item.type);
  return (
    <button type="button" className={`notification-card ${item.read ? 'is-read' : ''}`} onClick={() => onRead(item.id)} aria-label={`${item.read ? '확인한 알림' : '미확인 알림'}: ${item.title}`} style={{ '--alert-accent': theme.accent, '--alert-bg': theme.background, '--alert-text': theme.text, '--alert-badge': theme.badge } as React.CSSProperties}>
      <div className="notification-card-top"><span className="notification-type"><span aria-hidden="true" />{item.read ? '확인 · ' : ''}{theme.label}</span><time>{item.time}</time></div>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
    </button>
  );
}
