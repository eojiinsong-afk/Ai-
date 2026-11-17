"""GIS건물통합정보(AL_D010) SHP → Photo Sorting용 가벼운 건물 데이터.

- 좌표계: 입력(.prj, 보통 EPSG:5186) → EPSG:5179(UTM-K, 전국 단일 좌표계)
- 4km 격자 셀로 나누고, 셀마다 이진 데이터를 gzip으로 압축해 청크 파일(최대 약 4MB)에 이어 붙인다.
- 남기는 값: 외곽선(0.2m 단위, 0.3m 단순화), 지상층수, 지하층수, 높이, 용도, 사용승인연도, 법정동, 지번.
- 레코드(리틀엔디언): u16 꼭짓점수, u8 지상층, u8 지하층, u16 높이(0.1m), u8 용도, u8 연도-1900,
  u16 법정동 번호(index의 dongs), u8 지번 길이, 지번(ASCII), 꼭짓점 × (i16 x, i16 y)

사용:  python3 build_buildings.py <AL_D010_xx.shp> <출력폴더> <시도코드>
출력:  <출력폴더>/b_<시도>_<n>.bin, <출력폴더>/index_<시도>.json
"""
import gzip, json, math, os, struct, sys
import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import Polygon

CELL = 4000          # m
Q = 0.2              # 좌표 단위(m)
SIMPLIFY = 0.3       # m
CHUNK_MAX = 4 * 1024 * 1024

USES = ['', '단독주택', '공동주택', '제1종근린생활시설', '제2종근린생활시설', '문화및집회시설', '종교시설', '판매시설', '운수시설',
        '의료시설', '교육연구시설', '노유자시설', '수련시설', '운동시설', '업무시설', '숙박시설', '위락시설', '공장', '창고시설',
        '위험물저장및처리시설', '자동차관련시설', '동물및식물관련시설', '자원순환관련시설', '교정및군사시설', '방송통신시설',
        '발전시설', '묘지관련시설', '관광휴게시설', '장례시설', '야영장시설', '기타']


def main(shp, out, sido):
    os.makedirs(out, exist_ok=True)
    base = os.path.splitext(shp)[0]
    with open(base + '.prj', encoding='utf-8', errors='ignore') as f:
        src = CRS.from_wkt(f.read())
    tr = Transformer.from_crs(src, CRS.from_epsg(5179), always_xy=True)
    enc = 'euc-kr'
    if os.path.exists(base + '.cpg'):
        enc = open(base + '.cpg').read().strip().lower() or enc
    r = shapefile.Reader(base, encoding=enc, encodingErrors='replace')
    names = [f[0] for f in r.fields[1:]]
    ix = {k: names.index(k) for k in ('A3', 'A4', 'A5', 'A9', 'A13', 'A16', 'A26', 'A27') if k in names}
    dongs, dong_idx = [], {}
    use_idx = {u: i for i, u in enumerate(USES)}
    cells = {}
    n_in = n_out = 0
    for sr in r.iterShapeRecords():
        n_in += 1
        shp_ = sr.shape
        if not shp_.points:
            continue
        rec = sr.record
        floors = int(rec[ix['A26']] or 0) if 'A26' in ix else 0
        base_f = int(rec[ix['A27']] or 0) if 'A27' in ix else 0
        height = float(rec[ix['A16']] or 0) if 'A16' in ix else 0.0
        use = str(rec[ix['A9']] or '').strip() if 'A9' in ix else ''
        year = str(rec[ix['A13']] or '')[:4] if 'A13' in ix else ''
        u = use_idx.get(use, use_idx['기타'] if use else 0)
        y = int(year) - 1900 if year.isdigit() and 1900 < int(year) < 2155 else 0
        dname = str(rec[ix['A4']] or '').strip() if 'A4' in ix else ''
        if dname not in dong_idx:
            dong_idx[dname] = len(dongs); dongs.append(dname)
        dn = min(dong_idx[dname], 65535)
        jb = str(rec[ix['A5']] or '').strip().encode('ascii', 'ignore')[:20] if 'A5' in ix else b''
        parts = list(shp_.parts) + [len(shp_.points)]
        for a, b in zip(parts[:-1], parts[1:]):
            ring = shp_.points[a:b]
            if len(ring) < 4:
                continue
            xs, ys = tr.transform([p[0] for p in ring], [p[1] for p in ring])
            poly = Polygon(zip(xs, ys))
            if not poly.is_valid or poly.area < 4:
                # 구멍 난 링(중정 등)은 외곽만 남긴다. 4㎡ 미만은 버린다.
                if poly.area < 4:
                    continue
            if poly.exterior.is_ccw:  # 외곽 링만 (shapefile 외곽은 시계 방향)
                continue
            simp = poly.simplify(SIMPLIFY, preserve_topology=False)
            if simp.is_empty or simp.geom_type != 'Polygon':
                simp = poly
            coords = list(simp.exterior.coords)[:-1]
            if len(coords) < 3:
                continue
            c = simp.centroid
            cx, cy = int(c.x // CELL), int(c.y // CELL)
            ox, oy = cx * CELL, cy * CELL
            pts = [(round((x - ox) / Q), round((yv - oy) / Q)) for x, yv in coords]
            if any(abs(v) > 32767 for p in pts for v in p) or len(pts) > 65535:
                continue
            clamp = lambda v, hi: max(0, min(int(v), hi))
            body = struct.pack('<HBBHBBHB', len(pts), clamp(floors, 255), clamp(base_f, 255), clamp(round(height * 10), 65535), u, y, dn, len(jb)) + jb
            body += b''.join(struct.pack('<hh', *p) for p in pts)
            cells.setdefault((cx, cy), []).append(body)
            n_out += 1
    # 셀 → gzip → 청크
    index = {'format': 2, 'cell': CELL, 'q': Q, 'crs': 'EPSG:5179', 'uses': USES, 'sido': sido, 'dongs': dongs, 'cells': {}}
    chunk, chunk_no, chunk_buf = None, 0, bytearray()
    def flush():
        nonlocal chunk_buf, chunk_no
        if chunk_buf:
            with open(os.path.join(out, f'b_{sido}_{chunk_no}.bin'), 'wb') as f:
                f.write(chunk_buf)
            chunk_no += 1
            chunk_buf = bytearray()
    for (cx, cy) in sorted(cells):
        raw = struct.pack('<I', len(cells[(cx, cy)])) + b''.join(cells[(cx, cy)])
        gz = gzip.compress(raw, 9)
        if len(chunk_buf) + len(gz) > CHUNK_MAX:
            flush()
        index['cells'][f'{cx}_{cy}'] = [f'b_{sido}_{chunk_no}.bin', len(chunk_buf), len(gz), len(cells[(cx, cy)])]
        chunk_buf += gz
    flush()
    with open(os.path.join(out, f'index_{sido}.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(os.path.getsize(os.path.join(out, x)) for x in os.listdir(out) if x.startswith(f'b_{sido}_'))
    print(json.dumps({'sido': sido, 'in': n_in, 'buildings': n_out, 'cells': len(cells), 'chunks': chunk_no, 'bytes': total}))


if __name__ == '__main__':
    main(*sys.argv[1:4])
