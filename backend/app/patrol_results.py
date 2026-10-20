"""Sample-based patrol statistics. Demo jumps are never interpolated into zone entries."""
from datetime import datetime, timezone
from .geo import distance, zone_transition

def seconds(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def summarize(points, zones, started_at, ended_at=None, legacy=False):
    end = seconds(ended_at) if ended_at else datetime.now(timezone.utc).timestamp()
    entries = []
    for zone in zones:
        armed, count, dwell, previous = True, 0, 0.0, None
        first_entry = last_entry = None
        for point in points:
            t = seconds(point['measured_at'])
            d = distance((point['lat'], point['lng']), (zone['lat'], zone['lng']))
            inside = d <= zone['radius']
            if previous:
                dt = t - previous[0]
                if 0 <= dt <= 30 and previous[1]: dwell += dt
            armed, entered = zone_transition(armed, d, zone['radius'], zone['multiplier'])
            if entered:
                count += 1
                first_entry = first_entry or point['measured_at']
                last_entry = point['measured_at']
            previous = (t, inside)
        if previous and previous[1] and 0 <= end - previous[0] <= 30:
            dwell += end - previous[0]
        entries.append({**zone, 'entry_count': count, 'dwell_seconds': round(dwell, 1), 'first_entry_at': first_entry, 'last_entry_at': last_entry})
    return {'duration_seconds': round(max(0, end-seconds(started_at)), 1),
            'distance_m': round(sum(distance((a['lat'],a['lng']), (b['lat'],b['lng'])) for a,b in zip(points,points[1:])), 1),
            'entry_count': sum(z['entry_count'] for z in entries),
            'visited_zone_count': sum(z['entry_count'] > 0 for z in entries),
            'zones': entries, 'legacy': legacy, 'estimated': True}
