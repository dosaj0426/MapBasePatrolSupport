import { api } from './api';
export interface SessionIdentity { role: 'admin' | 'user'; officer_id: number | null; expires_at: string }
export async function logout() { await api('/access/logout',{method:'POST'}); window.location.replace('/'); }
