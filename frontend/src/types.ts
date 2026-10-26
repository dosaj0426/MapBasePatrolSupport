export type LocationSource = 'gps' | 'demo';
export type HeadingSource = 'sensor' | 'gps' | 'demo' | 'unknown';
export type AlertType = 'info' | 'warning' | 'danger' | 'emergency';
export interface Coordinates { lat: number; lng: number }
export interface RoutePoint extends Coordinates { time: number; source: LocationSource | 'start' }
export interface StoredPoint extends Coordinates { id?: number; sequence: number; measured_at: string; source: LocationSource }
export interface Officer { active: boolean; id: number; name: string; url: string; lat: number | null; lng: number | null; source: LocationSource | null; accuracy: number | null; updated_at: string | null; heading: number | null; heading_source: HeadingSource | null; heading_updated_at: string | null; active_patrol_id: number | null }
export interface Icon { id: number; name: string; filename: string; url: string }
export interface Address extends Coordinates { address: string; postal_code: string }
export interface Place extends Address { id: number; name: string; category: string; detail: string; icon_id: number | null; enhanced: boolean; radius: number; multiplier: number; message: string; alert_type: AlertType; revision: number }
export interface PlaceForm { name: string; category: string; address: string; postal_code: string; detail: string; icon_id: number | ''; enhanced: boolean; radius: number; multiplier: number; message: string; alert_type: AlertType; lat?: number; lng?: number }
export type MapSelection = Partial<Place> & Coordinates;
export interface ZoneResult extends Coordinates { buffer_m?: number; id: number; name: string; radius: number; multiplier: number; entry_count: number; dwell_seconds: number; first_entry_at: string | null; last_entry_at: string | null }
export interface PatrolResult { duration_seconds: number; distance_m: number; entry_count: number; visited_zone_count: number; zones: ZoneResult[]; legacy: boolean; estimated: boolean }
export interface Patrol { id: number; officer_id: number; officer_name?: string; started_at: string; ended_at: string | null; source: LocationSource }
export interface PatrolDetail extends Patrol { points: StoredPoint[]; result: PatrolResult }
export interface RestoredPatrol extends Patrol { points: RoutePoint[] }
export interface Alert { id: number; officer_id: number; type: AlertType; title: string; body: string; created_at: string; read: boolean }
export interface Notification { id: string | number; serverId?: number; type: AlertType; title: string; body: string; read?: boolean; time: string }
export interface HeadingSample { heading: number | null; source: HeadingSource; measured_at: string }
export interface PositionSample extends Coordinates { orientation?: HeadingSample | null; source: LocationSource; accuracy: number; measured_at: string }

export interface InspectionRecord { patrol_id: number; officer_name: string; started_at: string; ended_at: string; source: LocationSource; entry_count: number; dwell_seconds: number; first_entry_at: string | null; last_entry_at: string | null; legacy: boolean }
