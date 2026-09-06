#!/usr/bin/env python3
"""
행정경계 데이터 생성 — src/data/geo.js 를 다시 만들 때만 실행한다.

    python3 scripts/simplify-geo.py

원본: southkorea/southkorea-maps (통계청 2018 시도/시군구 경계, GeoJSON)
처리: 작은 섬 제거 → Douglas-Peucker 단순화 → 좌표를 1/10000도 정수로 델타 인코딩
결과: 시도 17개 + 시군구 249개, 약 160KB (원본 25MB)

지도는 외부 타일 서버를 쓰지 않는다. Artifact 로 게시하면 외부 이미지 요청이 차단되고,
답사지가 통신이 나쁜 곳일 수도 있어 경계 데이터를 앱 안에 넣는 편이 확실하다.
좌표 정밀도는 약 11m — 전국 분포와 시군구 판별에는 충분하고, 건물 단위 정밀도는 목적이 아니다.
"""
import json, os, sys, urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = {
    'sido': 'https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-provinces-2018-geo.json',
    'sgg':  'https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-geo.json',
}
TOL = {'sido': 0.006, 'sgg': 0.004}      # 단순화 허용오차 (도)
MIN_AREA = {'sido': 0.0008, 'sgg': 0.0006}  # 이보다 작은 섬은 버린다


def dp(pts, tol):
    """Douglas-Peucker 단순화 (반복 방식 — 재귀 한도 걱정 없음)"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]; bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, bi = -1, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / den))
                d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
            if d > best:
                best, bi = d, k
        if best > tol * tol:
            keep[bi] = True
            stack.append((i, bi)); stack.append((bi, j))
    return [q for q, k in zip(pts, keep) if k]


def ring_area(ring):
    s = 0
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def polygons(geom):
    t, c = geom['type'], geom['coordinates']
    return [c] if t == 'Polygon' else (c if t == 'MultiPolygon' else [])


def process(kind, raw):
    out = []
    for f in raw['features']:
        rings = []
        for poly in polygons(f['geometry']):
            ring = poly[0]                       # 외곽선만 사용 (구멍은 무시)
            if ring_area(ring) < MIN_AREA[kind]:
                continue
            s = dp([(round(x, 5), round(y, 5)) for x, y in ring], TOL[kind])
            if len(s) >= 4:
                rings.append(s)
        if not rings:
            continue
        enc = []
        for r in rings:                          # 델타 인코딩 (1/10000도 정수)
            arr, px, py = [], 0, 0
            for x, y in r:
                ix, iy = int(round(x * 10000)), int(round(y * 10000))
                arr += [ix - px, iy - py]
                px, py = ix, iy
            enc.append(arr)
        out.append({'n': f['properties']['name'], 'c': f['properties']['code'], 'r': enc})
    return out


def main():
    data = {}
    for kind, url in SRC.items():
        print(f'[geo] 내려받는 중: {kind}')
        with urllib.request.urlopen(url) as r:
            raw = json.load(r)
        data[kind] = process(kind, raw)
        print(f'[geo] {kind}: {len(data[kind])}개')
    js = 'window.KRGEO=' + json.dumps(
        {'sido': data['sido'], 'sgg': data['sgg']}, separators=(',', ':'), ensure_ascii=False) + ';'
    path = os.path.join(BASE, 'src', 'data', 'geo.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f'[geo] {path}  {len(js) // 1024} KB')


if __name__ == '__main__':
    sys.exit(main())
