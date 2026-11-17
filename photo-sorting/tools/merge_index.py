"""시도별 index_<시도>.json 을 하나의 data/index.json 으로 합친다.

사용:  python3 merge_index.py <변환 출력 폴더> <index.json 경로>
같은 4km 셀이 두 시도에 걸치면 셀 항목이 여러 개가 된다: cells[key] = [[시도, 파일, 시작, 길이, 건물수], ...]
"""
import glob, json, os, sys

src, dst = sys.argv[1], sys.argv[2]
out = {'format': 2, 'cell': None, 'q': None, 'crs': 'EPSG:5179', 'uses': None, 'dongs': {}, 'sidos': {}, 'cells': {}}
for p in sorted(glob.glob(os.path.join(src, 'index_*.json'))):
    ix = json.load(open(p, encoding='utf-8'))
    for k in ('cell', 'q', 'uses'):
        if out[k] is None:
            out[k] = ix[k]
        elif out[k] != ix[k]:
            raise SystemExit(f'{p}: {k} 값이 다릅니다')
    sd = ix['sido']
    out['dongs'][sd] = ix['dongs']
    out['sidos'][sd] = sum(v[3] for v in ix['cells'].values())
    for key, (file, off, ln, n) in ix['cells'].items():
        out['cells'].setdefault(key, []).append([sd, file, off, ln, n])
json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'sidos': out['sidos'], 'cells': len(out['cells']), 'bytes': os.path.getsize(dst)}, ensure_ascii=False))
