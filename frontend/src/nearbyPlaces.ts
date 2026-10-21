import type { Coordinates, Place } from './types';
import { distanceMeters } from './patrolTrack';
export function nearbyPlaces(places: Place[], center: Coordinates) {
  return places.map(place => ({ place, distance: distanceMeters(center, place) }))
    .sort((a,b) => a.distance-b.distance || a.place.id-b.place.id);
}
export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters/1000).toFixed(1)}km`;
}
