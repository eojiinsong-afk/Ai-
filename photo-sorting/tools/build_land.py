"""world-atlas(Natural Earth) land-50m TopoJSON → 지구본 육지 다각형 data/land.json

출력: [[lon, lat, lon, lat, ...], ...] 외곽 링 목록 (0.04° 단순화, 소수 둘째 자리)
사용:  python3 build_land.py <land-50m.json> <land.json>
"""
import json, os, sys
from shapely.geometry import Polygon

src, dst = sys.argv[1], sys.argv[2]
t = json.load(open(src))
sx, sy = t['transform']['scale']; tx, ty = t['transform']['translate']
arcs = []
for a in t['arcs']:
    x = y = 0; pts = []
    for dx, dy in a:
        x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

def ring(idx):
    out = []
    for i in idx:
        seg = arcs[i] if i >= 0 else arcs[~i][::-1]
        out.extend(seg if not out else seg[1:])
    return out

rings = []
for geom in t['objects']['land']['geometries']:
    polys = geom['arcs'] if geom['type'] == 'MultiPolygon' else [geom['arcs']]
    for poly in polys:
        outer = ring(poly[0])
        if len(outer) < 4:
            continue
        p = Polygon(outer).simplify(0.04, preserve_topology=True)
        if p.is_empty or p.area < 0.02:
            continue
        cs = list(p.exterior.coords) if p.geom_type == 'Polygon' else []
        if len(cs) >= 4:
            rings.append([round(v, 2) for xy in cs for v in xy])
json.dump(rings, open(dst, 'w'), separators=(',', ':'))
print(len(rings), os.path.getsize(dst))
