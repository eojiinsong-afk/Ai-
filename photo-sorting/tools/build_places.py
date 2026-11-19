"""변환한 건물 데이터(b_*.bin + index_*.json)로 주소 찾기용 목록 data/places.json 을 만든다.

인터넷 없이(Claude 아티팩트 안에서) '법정동 + 지번' 주소를 찾기 위한 것.
항목: [법정동 전체 이름, 시도 키, 법정동 번호, 중심 x, 중심 y (EPSG:5179, m), [셀 키...]]

사용:  python3 build_places.py <변환 출력 폴더> <places.json 경로>
"""
import glob, gzip, json, os, struct, sys

src, dst = sys.argv[1], sys.argv[2]
places = []
for p in sorted(glob.glob(os.path.join(src, 'index_*.json'))):
    ix = json.load(open(p, encoding='utf-8'))
    sd, C, Q = ix['sido'], ix['cell'], ix['q']
    acc = {}
    chunks = {}
    for key, (file, off, ln, n) in ix['cells'].items():
        if file not in chunks:
            chunks[file] = open(os.path.join(src, file), 'rb').read()
        raw = gzip.decompress(chunks[file][off:off + ln])
        cx, cy = map(int, key.split('_'))
        cnt = struct.unpack_from('<I', raw, 0)[0]
        o = 4
        for _ in range(cnt):
            nv, fl, bf, h, u, yr, dn, jl = struct.unpack_from('<HBBHBBHB', raw, o)
            o += 11 + jl
            x0, y0 = struct.unpack_from('<hh', raw, o)
            o += 4 * nv
            a = acc.setdefault(dn, [0.0, 0.0, 0, set()])
            a[0] += cx * C + x0 * Q
            a[1] += cy * C + y0 * Q
            a[2] += 1
            a[3].add(key)
    for dn, (sx, sy, n, cells) in acc.items():
        name = ix['dongs'][dn] if dn < len(ix['dongs']) else ''
        if name and n:
            places.append([name, sd, dn, round(sx / n), round(sy / n), sorted(cells)])
json.dump(places, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'places': len(places), 'bytes': os.path.getsize(dst)}))
