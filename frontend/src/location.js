export function moveTenMeters(position, key) {
  const bearings = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
  if (!(key in bearings)) return position;
  const radians = Math.PI / 180;
  const latitude = position.lat * radians;
  const longitude = position.lng * radians;
  const angle = bearings[key] * radians;
  const distance = 10 / 6371008.8;
  const nextLat = Math.asin(Math.sin(latitude) * Math.cos(distance) + Math.cos(latitude) * Math.sin(distance) * Math.cos(angle));
  const nextLng = longitude + Math.atan2(Math.sin(angle) * Math.sin(distance) * Math.cos(latitude), Math.cos(distance) - Math.sin(latitude) * Math.sin(nextLat));
  return { lat: nextLat / radians, lng: ((nextLng / radians + 540) % 360) - 180 };
}
