# Photo Sorting

한 장소의 답사 사진을 올리면 은하수처럼 모였다가 Claude가 건축요소(입구·창·계단·기타)별 행성으로 나누고, 애매한 사진은 질문으로 묻습니다. 분류가 끝나면 지구본에서 답사 위치로 내려가 3D 건물 위에서 사진마다 **찍은 자리와 바라본 방향**을 지정하고, 바라본 건물의 주소·용도·층수·사용승인연도를 자동으로 붙입니다.

Claude 아티팩트로 배포합니다(`index.html` 한 파일 + `data/`).

## 데이터 흐름

```
사진(EXIF: 시각·GPS·방향) ─┐
                            ├─ Claude 분류 + 질문 카드 → 건축요소
GIS건물통합정보(AL_D010) ───┤
  └ tools/build_buildings.py → data/b_*.bin, data/index.json (4km 격자, gzip)
                            └─ 3D 건물 + 매핑 → 찍은 자리·방향·대상 건물
출력: ZIP (요소별 폴더 · 사진목록.csv · photo-sorting.json)
```

## 건물 데이터 만들기

GIS건물통합정보 시도별 SHP ZIP(`AL_D010_<시도코드>_<날짜>.zip`)을 받아:

```bash
pip install pyshp pyproj shapely
python3 tools/build_buildings.py AL_D010_30_20261109.shp out 30   # 시도마다
python3 tools/merge_index.py out out/index.json
```

`out/b_*.bin`과 `out/index.json`을 아티팩트의 `data/`로 올립니다. 남기는 값: 외곽선(0.2m 단위, 0.3m 단순화), 지상·지하층수, 높이, 용도, 사용승인연도, 법정동, 지번. 대전 17만 동이 약 4.7MB입니다.

| 필드 | 뜻 |
|---|---|
| A4, A5 | 법정동명, 지번 |
| A9 | 용도 |
| A13 | 사용승인일 |
| A16 | 높이 (0이면 층수 × 3.3m로 대신) |
| A26, A27 | 지상층수, 지하층수 |

## 좌표

사진 GPS(WGS84) ↔ EPSG:5179(UTM-K). 변환식은 `index.html`의 `TM`에 있으며 pyproj 결과와 mm 단위까지 같습니다. 3D 장면은 답사 중심을 원점으로 x=동, z=남(북쪽이 -z), y=위입니다.

## 저장

사진(가로 2000px로 줄인 것), 분류, 매핑은 브라우저 IndexedDB에 저장됩니다. 다른 기기로 옮기려면 ZIP으로 내보냅니다.
