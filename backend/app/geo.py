from math import radians, sin, cos, asin, sqrt, atan2, degrees, isfinite

def distance(a, b):
    p, q = radians(a[0]), radians(b[0])
    h = sin((q-p)/2)**2 + cos(p)*cos(q)*sin(radians(b[1]-a[1])/2)**2
    return 12742017.6 * asin(min(1, sqrt(h)))

ZONE_BUFFER_M = 10

def zone_transition(armed, distance_m, radius, multiplier=1.5, buffer_m=None):
    if armed and distance_m <= radius: return False, True
    outer = radius + buffer_m if buffer_m is not None else radius * multiplier
    if not armed and distance_m > outer: return True, False
    return armed, False


def relative_side(origin, target, heading, minimum_distance=3):
    """Bearing is relative to heading (north=0, clockwise); ignore ambiguous near-center fixes."""
    if heading is None or not isfinite(heading) or distance(origin,target)<minimum_distance: return None
    lat1,lat2=radians(origin[0]),radians(target[0])
    delta=radians(target[1]-origin[1])
    bearing=degrees(atan2(sin(delta)*cos(lat2),cos(lat1)*sin(lat2)-sin(lat1)*cos(lat2)*cos(delta)))%360
    angle=(bearing-heading+540)%360-180
    if abs(angle)<=20: return '전방'
    if abs(angle)>=160: return '후방'
    return '우측' if angle>0 else '좌측'

def subject_particle(name):
    last=name.rstrip(' .!?\"\'()[]{}').strip()[-1:]
    if not last: return '가'
    code=ord(last)
    if 0xAC00<=code<=0xD7A3: return '이' if (code-0xAC00)%28 else '가'
    if last.isascii() and last.isdigit(): return '이' if last in '013678' else '가'
    return '이' if last.lower() in 'lmnr' else '가'

def zone_message(name, custom='', side=None):
    if side:
        intro=f'{side}에 {name}{subject_particle(name)} 있습니다.'
        return intro+(' '+custom if custom else '')
    return custom or f'{name} 범죄예방 강화구역이 있습니다. 주변을 확인해 주세요.'
