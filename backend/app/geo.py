from math import radians, sin, cos, asin, sqrt

def distance(a, b):
    p, q = radians(a[0]), radians(b[0])
    h = sin((q-p)/2)**2 + cos(p)*cos(q)*sin(radians(b[1]-a[1])/2)**2
    return 12742017.6 * asin(min(1, sqrt(h)))

def zone_transition(armed, distance_m, radius, multiplier):
    if armed and distance_m <= radius: return False, True
    if not armed and distance_m > radius * multiplier: return True, False
    return armed, False
