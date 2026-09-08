/* ============================================================
   공간 데이터 가져오기 — CSV · GeoJSON · Shapefile (+ ZIP)

   QGIS 에 레이어를 얹듯이 공공데이터를 참조 지점으로 들여온다.
   외부 라이브러리를 못 쓰므로(Artifact 는 외부 스크립트를 불러오지 못한다)
   인코딩 판별 · CSV · DBF · SHP · ZIP · 좌표계 변환을 전부 직접 구현했다.

   가져오기는 언제나 "더하기"다. 기존 문서를 지우거나 덮어쓰지 않는다.
   들여온 문서에는 출처(src)를 남겨 나중에 한 묶음씩 되돌릴 수 있게 한다.
   ============================================================ */

/* ---------- 인코딩 ----------
   공공데이터포털 CSV 는 EUC-KR(CP949) 인 경우가 아직 많다.
   UTF-8 로 읽어 치환문자(U+FFFD)가 섞이면 EUC-KR 로 다시 읽는다. */
function decodeText(buf, forced) {
  const u8 = new Uint8Array(buf);
  if (forced) return { text: new TextDecoder(forced, { fatal: false }).decode(u8), enc: forced };
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
    return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), enc: 'utf-8 (BOM)' };
  }
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return { text: t, enc: 'utf-8' };
  } catch (e) { }
  try {
    return { text: new TextDecoder('euc-kr').decode(u8), enc: 'euc-kr (CP949)' };
  } catch (e) {
    return { text: new TextDecoder('utf-8').decode(u8), enc: 'utf-8 (일부 깨짐)' };
  }
}

/* ---------- CSV ---------- */
function sniffDelim(line) {
  const cand = [',', ';', '\t', '|'];
  let best = ',', bn = 0;
  for (const c of cand) {
    const n = line.split(c).length - 1;
    if (n > bn) { bn = n; best = c; }
  }
  return best;
}
function parseCsv(text, delim) {
  const t = text.replace(/\r\n?/g, '\n');
  const d = delim || sniffDelim(t.slice(0, t.indexOf('\n') > 0 ? t.indexOf('\n') : 400));
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  const header = (rows.shift() || []).map(h => h.trim().replace(/^﻿/, ''));
  return { header, rows: rows.filter(r => r.some(c => c.trim() !== '')), delim: d };
}

/* ---------- 좌표계 ----------
   한국 공공데이터가 실제로 쓰는 것들만 담았다. TM 역변환 + 구 좌표계(Bessel) 데이텀 변환. */
const ELL = {
  GRS80: { a: 6378137, if_: 298.257222101 },
  WGS84: { a: 6378137, if_: 298.257223563 },
  BESSEL: { a: 6377397.155, if_: 299.1528128 }
};
/* 구 좌표계(Korean Datum 1985, Bessel) → WGS84.
   EPSG 가 정의한 변환은 단순 7-파라미터가 아니라 **Molodensky-Badekas**(회전 기준점을 둔
   10-파라미터)이고 회전 방향은 coordinate_frame 규약이다. 단순 Helmert 로 계산하면
   전국에서 20m 안팎이 어긋난다 — 시장아파트와 역 사이 거리를 재는 데 그냥 넘길 오차가 아니다.
   값은 EPSG:1133 "Korean 1985 to WGS 84 (1)". */
const BESSEL_TO_WGS84 = {
  dx: -145.907, dy: 505.034, dz: 685.756,          // m
  rx: -1.162, ry: 2.347, rz: 1.592,                // 초(")
  s: 6.342,                                        // ppm
  px: -3159521.31, py: 4068151.32, pz: 3748113.85  // 회전 기준점 (m)
};
const CRS_LIST = [
  { id: '4326', label: 'WGS84 경위도 (EPSG:4326) — 대부분의 공공데이터', kind: 'geo' },
  { id: '5179', label: 'UTM-K (EPSG:5179) — 국가공간정보·도로명주소', kind: 'tm', ell: 'GRS80', lat0: 38, lon0: 127.5, k0: 0.9996, x0: 1000000, y0: 2000000 },
  { id: '5186', label: '중부원점 TM (EPSG:5186) — GRS80', kind: 'tm', ell: 'GRS80', lat0: 38, lon0: 127, k0: 1, x0: 200000, y0: 600000 },
  { id: '5185', label: '서부원점 TM (EPSG:5185) — GRS80', kind: 'tm', ell: 'GRS80', lat0: 38, lon0: 125, k0: 1, x0: 200000, y0: 600000 },
  { id: '5187', label: '동부원점 TM (EPSG:5187) — GRS80', kind: 'tm', ell: 'GRS80', lat0: 38, lon0: 129, k0: 1, x0: 200000, y0: 600000 },
  { id: '5188', label: '동해원점 TM (EPSG:5188) — GRS80', kind: 'tm', ell: 'GRS80', lat0: 38, lon0: 131, k0: 1, x0: 200000, y0: 600000 },
  { id: '5174', label: '구 중부원점 TM (EPSG:5174) — Bessel', kind: 'tm', ell: 'BESSEL', lat0: 38, lon0: 127.0028902777778, k0: 1, x0: 200000, y0: 500000 },
  { id: '5173', label: '구 서부원점 TM (EPSG:5173) — Bessel', kind: 'tm', ell: 'BESSEL', lat0: 38, lon0: 125.0028902777778, k0: 1, x0: 200000, y0: 500000 },
  { id: '5176', label: '구 동부원점 TM (EPSG:5176) — Bessel', kind: 'tm', ell: 'BESSEL', lat0: 38, lon0: 129.0028902777778, k0: 1, x0: 200000, y0: 500000 },
  { id: '5177', label: '구 동해원점 TM (EPSG:5177) — Bessel', kind: 'tm', ell: 'BESSEL', lat0: 38, lon0: 131.0028902777778, k0: 1, x0: 200000, y0: 500000 },
  { id: '3857', label: 'Web Mercator (EPSG:3857) — 웹지도 타일', kind: 'merc' }
];
function crsById(id) { return CRS_LIST.find(c => c.id === id) || CRS_LIST[0]; }
/** 횡메르카토르 역변환 (Snyder). x·y 는 미터. */
function tmInverse(x, y, P) {
  const E = ELL[P.ell], a = E.a, f = 1 / E.if_;
  const e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const M0 = meridArc(P.lat0 * Math.PI / 180, a, e2);
  const M = M0 + (y - P.y0) / P.k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const C1 = ep2 * c * c, T1 = t * t;
  const N1 = a / Math.sqrt(1 - e2 * s * s);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
  const D = (x - P.x0) / (N1 * P.k0);
  const lat = phi1 - (N1 * t / R1) * (D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = P.lon0 * Math.PI / 180 + (D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [lat * 180 / Math.PI, lon * 180 / Math.PI];
}
function meridArc(phi, a, e2) {
  return a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
}
/** Bessel 타원체 위의 경위도를 WGS84 로 옮긴다 (Molodensky-Badekas, coordinate_frame). */
function besselToWgs84(lat, lon) {
  const T = BESSEL_TO_WGS84;
  const B = ELL.BESSEL, fB = 1 / B.if_, e2B = 2 * fB - fB * fB;
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  const N = B.a / Math.sqrt(1 - e2B * Math.sin(p) ** 2);
  const X = N * Math.cos(p) * Math.cos(l), Y = N * Math.cos(p) * Math.sin(l), Z = N * (1 - e2B) * Math.sin(p);
  const r = Math.PI / (180 * 3600);
  const rx = T.rx * r, ry = T.ry * r, rz = T.rz * r, k = 1 + T.s / 1e6;
  const dX = X - T.px, dY = Y - T.py, dZ = Z - T.pz;
  const X2 = T.px + T.dx + k * (dX + rz * dY - ry * dZ);
  const Y2 = T.py + T.dy + k * (-rz * dX + dY + rx * dZ);
  const Z2 = T.pz + T.dz + k * (ry * dX - rx * dY + dZ);
  // WGS84 지오센트릭 → 경위도 (반복법)
  const W = ELL.WGS84, fW = 1 / W.if_, e2W = 2 * fW - fW * fW, aW = W.a;
  const lon2 = Math.atan2(Y2, X2);
  const pxy = Math.hypot(X2, Y2);
  let lat2 = Math.atan2(Z2, pxy * (1 - e2W));
  for (let i = 0; i < 6; i++) {
    const n = aW / Math.sqrt(1 - e2W * Math.sin(lat2) ** 2);
    lat2 = Math.atan2(Z2 + e2W * n * Math.sin(lat2), pxy);
  }
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}
/** 임의 좌표 → WGS84 경위도. 입력 순서는 (x=경도/동, y=위도/북). */
function toWgs84(x, y, crs) {
  if (!isFinite(x) || !isFinite(y)) return null;
  if (crs.kind === 'geo') return [y, x];
  if (crs.kind === 'merc') {
    const R = 6378137;
    return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI];
  }
  const [la, ln] = tmInverse(x, y, crs);
  return crs.ell === 'BESSEL' ? besselToWgs84(la, ln) : [la, ln];
}
/** .prj(WKT) 에서 좌표계를 알아낸다. 이름이 아니라 파라미터를 읽으므로 변종도 잡힌다. */
function crsFromPrj(wkt) {
  if (!wkt) return null;
  const w = wkt.replace(/\s+/g, ' ');
  if (/Mercator_Auxiliary_Sphere|Pseudo[-_ ]?Mercator|EPSG.{0,4}3857/i.test(w)) return crsById('3857');
  if (!/PROJCS/i.test(w)) return crsById('4326');
  if (!/Transverse_Mercator/i.test(w)) return null;
  const par = n => { const m = w.match(new RegExp('PARAMETER\\s*\\[\\s*"' + n + '"\\s*,\\s*(-?[\\d.]+)', 'i')); return m ? +m[1] : null; };
  const sph = w.match(/SPHEROID\s*\[\s*"([^"]*)"\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  const aVal = sph ? +sph[2] : 6378137;
  const ell = Math.abs(aVal - 6377397.155) < 1 ? 'BESSEL' : 'GRS80';
  const lon0 = par('central_meridian') ?? par('longitude_of_center');
  if (lon0 == null) return null;
  return {
    id: 'prj', label: `.prj 에서 읽음 — TM ${ell === 'BESSEL' ? 'Bessel(구 좌표계)' : 'GRS80'} · 원점경도 ${lon0}°`,
    kind: 'tm', ell, lat0: par('latitude_of_origin') ?? 38, lon0,
    k0: par('scale_factor') ?? 1, x0: par('false_easting') ?? 0, y0: par('false_northing') ?? 0
  };
}
/** 좌표값의 크기로 좌표계를 짐작한다 (.prj 가 없을 때) */
function guessCrs(xs, ys) {
  const mx = Math.max(...xs.map(Math.abs)), my = Math.max(...ys.map(Math.abs));
  if (mx <= 190 && my <= 90) return crsById('4326');
  if (mx > 700000 && my > 1200000) return crsById('5179');
  if (mx > 1e6) return crsById('3857');
  if (my > 400000 && my < 800000) return crsById('5186');
  return null;
}

/* ---------- ZIP 읽기 ---------- */
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // 끝에서 EOCD 를 찾는다
  let eo = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  }
  if (eo < 0) throw new Error('ZIP 구조를 읽지 못했습니다');
  const n = dv.getUint16(eo + 10, true);
  let p = dv.getUint32(eo + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (/\/$/.test(name)) continue;
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lel;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      if (typeof DecompressionStream !== 'function') throw new Error('이 브라우저는 압축된 ZIP 을 풀 수 없습니다. 압축을 풀고 파일을 직접 올려주세요.');
      const ds = new DecompressionStream('deflate-raw');
      const ab = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      data = new Uint8Array(ab);
    } else continue;
    out.push({ name: name.split('/').pop(), path: name, data, usize });
  }
  return out;
}

/* ---------- Shapefile ---------- */
function readShp(buf) {
  const dv = new DataView(buf);
  if (dv.getInt32(0, false) !== 9994) throw new Error('.shp 파일이 아닙니다');
  const total = dv.getInt32(24, false) * 2;
  const feats = [];
  let p = 100;
  while (p + 8 <= total && p + 8 <= dv.byteLength) {
    const len = dv.getInt32(p + 4, false) * 2;
    const t = dv.getInt32(p + 8, true);
    const c = p + 12;
    if (t === 1 || t === 11 || t === 21) {
      feats.push({ type: 'point', xy: [dv.getFloat64(c, true), dv.getFloat64(c + 8, true)] });
    } else if (t === 3 || t === 13 || t === 23 || t === 5 || t === 15 || t === 25) {
      const nParts = dv.getInt32(c + 32, true), nPts = dv.getInt32(c + 36, true);
      const parts = [];
      for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(c + 40 + i * 4, true));
      const po = c + 40 + nParts * 4;
      const pts = [];
      for (let i = 0; i < nPts; i++) pts.push([dv.getFloat64(po + i * 16, true), dv.getFloat64(po + i * 16 + 8, true)]);
      const rings = parts.map((s, i) => pts.slice(s, i + 1 < nParts ? parts[i + 1] : nPts));
      feats.push({ type: (t === 5 || t === 15 || t === 25) ? 'polygon' : 'line', rings });
    } else if (t === 0) feats.push({ type: 'null' });
    else feats.push({ type: 'skip' });
    p += 8 + len;
  }
  return feats;
}
function readDbf(buf, enc) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const nRec = dv.getUint32(4, true), hLen = dv.getUint16(8, true), rLen = dv.getUint16(10, true);
  const dec = new TextDecoder(enc || 'euc-kr', { fatal: false });
  const fields = [];
  for (let p = 32; p < hLen - 1 && u8[p] !== 0x0D; p += 32) {
    let name = '';
    for (let i = 0; i < 11 && u8[p + i]; i++) name += String.fromCharCode(u8[p + i]);
    fields.push({ name: dec.decode(u8.subarray(p, p + name.length)) || name, type: String.fromCharCode(u8[p + 11]), len: u8[p + 16] });
  }
  const rows = [];
  for (let r = 0; r < nRec; r++) {
    const base = hLen + r * rLen;
    if (base + rLen > u8.length) break;
    if (u8[base] === 0x2A) { rows.push(null); continue; }   // 삭제 표시
    const o = {};
    let off = base + 1;
    for (const f of fields) {
      const raw = dec.decode(u8.subarray(off, off + f.len)).trim();
      o[f.name] = (f.type === 'N' || f.type === 'F') ? (raw === '' ? null : +raw) : raw;
      off += f.len;
    }
    rows.push(o);
  }
  return { fields: fields.map(f => f.name), rows };
}

/* ---------- GeoJSON ---------- */
function readGeoJson(text) {
  const g = JSON.parse(text);
  const feats = (g.type === 'FeatureCollection' ? g.features : g.type === 'Feature' ? [g] : []).filter(Boolean);
  const out = [], props = [];
  for (const f of feats) {
    const gm = f.geometry; if (!gm) continue;
    if (gm.type === 'Point') out.push({ type: 'point', xy: gm.coordinates });
    else if (gm.type === 'LineString') out.push({ type: 'line', rings: [gm.coordinates] });
    else if (gm.type === 'MultiLineString') out.push({ type: 'line', rings: gm.coordinates });
    else if (gm.type === 'Polygon') out.push({ type: 'polygon', rings: gm.coordinates });
    else if (gm.type === 'MultiPolygon') out.push({ type: 'polygon', rings: gm.coordinates.flat() });
    else { out.push({ type: 'skip' }); }
    props.push(f.properties || {});
  }
  const keys = Array.from(new Set(props.flatMap(p => Object.keys(p))));
  return { feats: out, attr: { fields: keys, rows: props } };
}

/* ============================================================
   가져오기 화면
   ============================================================ */
const IMP = { src: null, files: [], target: 'station', map: {}, crs: null, rows: [] };
/** 열 이름에서 뜻을 짐작한다. 공공데이터의 흔한 표기를 모아 두었다. */
const COL_HINTS = {
  lat: [/^위도$/, /위도/, /^lat$/i, /latitude/i, /^y좌표$/i, /^ycrd/i, /^y$/i],
  lng: [/^경도$/, /경도/, /^lng$/i, /^lon$/i, /longitude/i, /^x좌표$/i, /^xcrd/i, /^x$/i],
  name: [/역사?명/, /터미널명/, /시장명/, /^명칭$/, /명칭/, /^이름$/, /^name$/i, /시설명/, /^station/i, /상호/],
  year: [/개[업통]/, /설립/, /[연년]도/, /^year$/i, /준공/, /지정일/, /설치[연년]/, /^연혁/],
  note: [/주소/, /소재지/, /^addr/i, /address/i, /비고/, /메모/, /설명/, /운영/, /노선명/]
};
function guessCol(header, kind) {
  for (const re of COL_HINTS[kind]) {
    const i = header.findIndex(h => re.test(String(h).trim()));
    if (i >= 0) return i;
  }
  return -1;
}
/** .prj 가 없을 때 좌표값의 크기로 좌표계를 짐작한다 */
function sniffCrs(S0) {
  const xs = [], ys = [];
  if (S0.type === 'csv') {
    const li = guessCol(S0.header, 'lat'), gi = guessCol(S0.header, 'lng');
    if (li < 0 || gi < 0) return null;
    for (const r of S0.csvRows.slice(0, 60)) {
      const y = parseFloat(String(r[li]).replace(/[^\d.eE+-]/g, ''));
      const x = parseFloat(String(r[gi]).replace(/[^\d.eE+-]/g, ''));
      if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); }
    }
  } else {
    for (const f of S0.feats.slice(0, 60)) {
      const p = f.type === 'point' ? f.xy : (f.rings && f.rings[0] && f.rings[0][0]);
      if (p && isFinite(p[0]) && isFinite(p[1])) { xs.push(p[0]); ys.push(p[1]); }
    }
  }
  if (!xs.length) return null;
  return guessCrs(xs, ys);
}
const IMPORT_TARGETS = [
  { k: 'station', label: '현재 기차역', geom: 'point' },
  { k: 'oldstation', label: '과거 기차역 (1970–80s)', geom: 'point' },
  { k: 'terminal', label: '버스터미널', geom: 'point' },
  { k: 'market', label: '시장', geom: 'point' },
  { k: 'rail', label: '현재 철도 노선', geom: 'line' },
  { k: 'oldrail', label: '과거 철도 노선', geom: 'line' },
  { k: 'project', label: '시장아파트 프로젝트', geom: 'point' }
];

async function importDialog() {
  IMP.src = null; IMP.rows = [];
  openModal(`<div class="mh"><h3>공간 데이터 가져오기</h3><button class="x">×</button></div>
    <div class="mb" id="impBody">
      <div id="impDrop" style="border:2px dashed var(--line2);border-radius:var(--r);padding:26px;text-align:center;background:var(--surface2)">
        <p style="margin:0 0 4px;font-weight:600">파일을 끌어다 놓거나 선택하세요</p>
        <p class="hint" style="margin:0 0 12px">CSV · GeoJSON · Shapefile(.shp + .dbf, .prj 있으면 좌표계 자동 인식) · 이들을 담은 ZIP</p>
        <label class="btn pri" style="margin:0">파일 선택<input type="file" id="impFile" multiple hidden
          accept=".csv,.txt,.tsv,.json,.geojson,.shp,.dbf,.prj,.cpg,.zip"></label>
      </div>
      <div class="anagrid" style="padding:0;margin-top:14px;grid-template-columns:1fr 1fr">
        <div class="card pad"><div class="sech"><h3>받는 형식</h3><div class="ln"></div></div>
          <p class="hint" style="margin:0">· <b>CSV</b> — 이름·위도·경도 열을 직접 짚어 줍니다. EUC-KR(CP949)도 자동으로 읽습니다.<br>
          · <b>Shapefile</b> — <span class="mono">.shp</span> 과 <span class="mono">.dbf</span> 를 함께 올리세요. <span class="mono">.prj</span> 가 있으면 좌표계를 읽어 변환합니다.<br>
          · <b>GeoJSON</b> — 점·선 도형과 속성을 그대로 받습니다.</p></div>
        <div class="card pad"><div class="sech"><h3>좌표계</h3><div class="ln"></div></div>
          <p class="hint" style="margin:0">WGS84 경위도, UTM-K(5179), 중부·서부·동부·동해원점 TM(GRS80 / 구 Bessel 좌표계), Web Mercator 를 변환합니다.
          구 좌표계는 7-파라미터 데이텀 변환까지 적용합니다.</p></div>
      </div>
      <p class="hint" style="margin-top:12px">가져오기는 <b>더하기만</b> 합니다. 지금 저장된 지점을 지우거나 덮어쓰지 않고, 들여온 항목에는 출처를 남겨 나중에 한 묶음씩 되돌릴 수 있습니다.</p>
    </div>
    <div class="mf"><span class="hint" id="impStat"></span><span class="spacer"></span>
      <button class="btn" onclick="closeModal()">닫기</button></div>`, { wide: true });
  const drop = $('#impDrop');
  $('#impFile').onchange = e => takeFiles(Array.from(e.target.files || []));
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.style.borderColor = ''; }));
  drop.addEventListener('drop', e => takeFiles(Array.from(e.dataTransfer.files || [])));
}
async function takeFiles(files) {
  if (!files.length) return;
  $('#impStat').textContent = '읽는 중…';
  try {
    let parts = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      if (/\.zip$/i.test(f.name)) parts = parts.concat(await unzip(buf));
      else parts.push({ name: f.name, data: new Uint8Array(buf) });
    }
    IMP.src = await buildSource(parts);
    renderMapping();
  } catch (e) {
    console.error(e);
    $('#impStat').textContent = '';
    toast('읽지 못했습니다: ' + (e && e.message || e), 4600);
  }
}
const bufOf = p => p.data.buffer.slice(p.data.byteOffset, p.data.byteOffset + p.data.byteLength);
/** 올린 파일 묶음에서 도형 + 속성 + 좌표계를 뽑아낸다 */
async function buildSource(parts) {
  const find = re => parts.find(p => re.test(p.name));
  const shp = find(/\.shp$/i), dbf = find(/\.dbf$/i), prj = find(/\.prj$/i), cpg = find(/\.cpg$/i);
  if (shp) {
    const feats = readShp(bufOf(shp));
    const cpgEnc = cpg ? decodeText(bufOf(cpg)).text.trim().toLowerCase() : '';
    const enc = /utf-?8/.test(cpgEnc) ? 'utf-8' : 'euc-kr';
    const attr = dbf ? readDbf(bufOf(dbf), enc) : { fields: [], rows: feats.map(() => ({})) };
    const crs = prj ? crsFromPrj(decodeText(bufOf(prj)).text) : null;
    return {
      type: 'shp', label: `${shp.name}${dbf ? ' + ' + dbf.name : ' (.dbf 없음 — 속성 없이 도형만)'}`,
      feats, fields: attr.fields, rows: attr.rows, crs, crsFrom: crs ? (prj ? '.prj 파일' : '') : '',
      enc: dbf ? enc : '—'
    };
  }
  const gj = find(/\.(geo)?json$/i);
  if (gj) {
    const { text, enc } = decodeText(bufOf(gj));
    const g = readGeoJson(text);
    return { type: 'geojson', label: gj.name, feats: g.feats, fields: g.attr.fields, rows: g.attr.rows, crs: crsById('4326'), crsFrom: 'GeoJSON 규격', enc };
  }
  const csv = find(/\.(csv|tsv|txt)$/i) || parts[0];
  if (!csv) throw new Error('읽을 수 있는 파일이 없습니다');
  const { text, enc } = decodeText(bufOf(csv));
  const { header, rows, delim } = parseCsv(text);
  if (!header.length) throw new Error('표의 머리글을 찾지 못했습니다');
  return {
    type: 'csv', label: csv.name, header, csvRows: rows, enc,
    delim: delim === '\t' ? '탭' : delim, fields: header,
    rows: rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])))
  };
}

function renderMapping() {
  const S0 = IMP.src;
  const n = S0.type === 'csv' ? S0.csvRows.length : S0.feats.length;
  const hasLine = S0.type !== 'csv' && S0.feats.some(f => f.type === 'line');
  IMP.target = hasLine ? 'rail' : 'station';
  const opt = (arr, cur, val, lbl) => arr.map(o => `<option value="${esc(val(o))}" ${cur === val(o) ? 'selected' : ''}>${esc(lbl(o))}</option>`).join('');
  const colSel = (id, kind, extra) => {
    const g = guessCol(S0.fields, kind);
    return `<select id="${id}">${extra ? `<option value="" ${g < 0 ? 'selected' : ''}>(비움)</option>` : ''}${S0.fields.map((h, i) =>
      `<option value="${esc(h)}" ${i === g ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select>`;
  };
  // .prj 가 없으면 좌표값의 크기로 좌표계를 짐작한다
  const detected = S0.crs || sniffCrs(S0);
  $('#impBody').innerHTML = `
    <div class="statrow" style="margin-bottom:14px">
      <div class="stat"><b>${n}</b><span>${S0.type === 'csv' ? '행' : '도형'}</span></div>
      <div class="stat"><b>${S0.type.toUpperCase()}</b><span>형식</span></div>
      <div class="stat" style="min-width:120px"><b style="font-size:13px">${esc(S0.enc)}</b><span>인코딩</span></div>
      <div class="stat" style="min-width:160px"><b style="font-size:13px">${esc(S0.label)}</b><span>원본</span></div>
    </div>
    <div class="formgrid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      <label class="fld"><span>가져올 대상</span><select id="im_t">${opt(IMPORT_TARGETS.filter(t => hasLine ? t.geom === 'line' : true), IMP.target, t => t.k, t => t.label)}</select></label>
      <label class="fld"><span>좌표계</span><select id="im_crs">${S0.crs && S0.crs.id === 'prj' ? `<option value="prj" selected>${esc(S0.crs.label)}</option>` : ''}${opt(CRS_LIST, (detected || {}).id, c => c.id, c => c.label)}</select></label>
      <label class="fld"><span>이름</span>${colSel('im_name', 'name')}</label>
      ${S0.type === 'csv' ? `<label class="fld"><span>위도 · Y</span>${colSel('im_lat', 'lat')}</label>
      <label class="fld"><span>경도 · X</span>${colSel('im_lng', 'lng')}</label>` : ''}
      <label class="fld"><span>연도 (선택)</span>${colSel('im_year', 'year', 1)}</label>
      <label class="fld"><span>메모로 쓸 열 (선택)</span>${colSel('im_note', 'note', 1)}</label>
    </div>
    <p class="hint" style="margin-top:8px">${S0.crsFrom
      ? `좌표계를 <b>${esc(S0.crsFrom)}</b> 에서 읽었습니다: ${esc((S0.crs || {}).label || '')}`
      : detected ? `.prj 가 없어 좌표값의 크기로 <b>${esc(detected.label)}</b> 로 짐작했습니다. 미리보기의 위경도가 맞는지 확인하세요.`
      : '좌표계를 알아내지 못했습니다. 아래 미리보기를 보면서 직접 고르세요.'}</p>
    <div class="sech" style="margin:16px 0 8px"><h3>미리보기</h3><div class="ln"></div><span class="hint" id="im_warn"></span></div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px;align-items:start">
      <div class="tblwrap" style="max-height:220px;border:1px solid var(--line);border-radius:var(--r)"><table class="grid" id="im_tbl"></table></div>
      <div><svg id="im_map" style="width:100%;height:220px;border:1px solid var(--line);border-radius:var(--r);background:var(--sea);display:block"></svg>
        <label class="lyr" style="margin-top:6px"><input type="checkbox" id="im_dedup" checked><span>같은 자리(40m 이내)의 같은 종류는 건너뛰기</span></label></div>
    </div>`;
  $('#impBody').insertAdjacentHTML('afterbegin', '');
  ['im_t', 'im_crs', 'im_name', 'im_lat', 'im_lng', 'im_year', 'im_note'].forEach(id => {
    const el = $('#' + id); if (el) el.onchange = refreshPreview;
  });
  $('#modalbox .mf').innerHTML = `<span class="hint" id="impStat"></span><span class="spacer"></span>
    <button class="btn" id="im_back">다른 파일</button><button class="btn pri" id="im_go">가져오기</button>`;
  $('#im_back').onclick = () => importDialog();
  $('#im_go').onclick = runImport;
  refreshPreview();
}
/** 현재 매핑대로 실제 넣을 항목들을 만든다 */
function buildRows() {
  const S0 = IMP.src;
  const crs = $('#im_crs').value === 'prj' ? S0.crs : crsById($('#im_crs').value);
  IMP.crs = crs;
  IMP.target = $('#im_t').value;
  const nameK = $('#im_name').value, yearK = $('#im_year') ? $('#im_year').value : '';
  const noteK = $('#im_note') ? $('#im_note').value : '';
  const out = [];
  const val = (row, k) => (k && row && row[k] != null) ? String(row[k]).trim() : '';
  if (S0.type === 'csv') {
    const li = S0.header.indexOf($('#im_lat').value), gi = S0.header.indexOf($('#im_lng').value);
    for (const r of S0.csvRows) {
      const row = Object.fromEntries(S0.header.map((h, i) => [h, r[i]]));
      const yv = parseFloat(String(r[li]).replace(/[^\d.eE+-]/g, ''));
      const xv = parseFloat(String(r[gi]).replace(/[^\d.eE+-]/g, ''));
      const p = toWgs84(xv, yv, crs);
      out.push({ name: val(row, nameK), year: val(row, yearK), note: val(row, noteK), lat: p && p[0], lng: p && p[1], row });
    }
  } else {
    S0.feats.forEach((f, i) => {
      const row = S0.rows[i] || {};
      const base = { name: val(row, nameK), year: val(row, yearK), note: val(row, noteK), row };
      if (f.type === 'point') {
        const p = toWgs84(f.xy[0], f.xy[1], crs);
        out.push(Object.assign(base, { lat: p && p[0], lng: p && p[1] }));
      } else if (f.type === 'line' || f.type === 'polygon') {
        const rings = f.rings.map(r => r.map(q => toWgs84(q[0], q[1], crs)).filter(Boolean));
        const longest = rings.sort((a, b) => b.length - a.length)[0] || [];
        if (f.type === 'polygon' || IMPORT_TARGETS.find(t => t.k === IMP.target).geom === 'point') {
          // 면·선을 점으로 받을 때는 도형의 가운데를 쓴다
          const mid = longest[Math.floor(longest.length / 2)];
          out.push(Object.assign(base, { lat: mid && mid[0], lng: mid && mid[1] }));
        } else {
          out.push(Object.assign(base, { path: simplifyPath(longest), lat: longest[0] && longest[0][0], lng: longest[0] && longest[0][1] }));
        }
      } else out.push(Object.assign(base, { lat: null, lng: null }));
    });
  }
  return out.map(o => Object.assign(o, { ok: inKorea(o.lat, o.lng) }));
}
/** 노선 점이 너무 많으면 문서 크기 한도(256KB)를 넘는다 — 굵은 형태만 남긴다 */
function simplifyPath(pts, max) {
  const lim = max || 400;
  if (pts.length <= lim) return pts.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
  const step = pts.length / lim;
  const out = [];
  for (let i = 0; i < lim; i++) out.push(pts[Math.floor(i * step)]);
  out.push(pts[pts.length - 1]);
  return out.map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]);
}
function refreshPreview() {
  const rows = IMP.rows = buildRows();
  const ok = rows.filter(r => r.ok);
  const bad = rows.length - ok.length;
  $('#im_warn').innerHTML = bad
    ? `<span style="color:var(--warn)">${bad}건은 좌표가 비었거나 남한 범위 밖입니다 — 건너뜁니다. 좌표계나 위도·경도 열을 확인하세요.</span>`
    : `${ok.length}건 모두 남한 범위 안입니다`;
  const head = ['이름', '위도', '경도', IMP.target === 'rail' || IMP.target === 'oldrail' ? '점' : '연도', '메모'];
  $('#im_tbl').innerHTML = `<thead><tr>${head.map(h => `<th style="cursor:default">${h}</th>`).join('')}</tr></thead><tbody>
    ${rows.slice(0, 40).map(r => `<tr${r.ok ? '' : ' style="opacity:.45"'}>
      <td>${esc(r.name || '(이름 없음)')}</td>
      <td class="n">${r.lat == null ? '—' : r.lat.toFixed(5)}</td>
      <td class="n">${r.lng == null ? '—' : r.lng.toFixed(5)}</td>
      <td class="n">${r.path ? r.path.length : esc(r.year || '')}</td>
      <td>${esc((r.note || '').slice(0, 40))}</td></tr>`).join('')}</tbody>`;
  try {
    const pts = ok.slice(0, 900).map((r, i) => ({ id: 'i' + i, lat: r.lat, lng: r.lng, name: r.name }));
    $('#im_map').outerHTML = staticMapSvg({ items: pts, all: [], whole: pts.length > 1, W: 300, H: 220, pad: 8, geoLabels: false })
      .replace('<svg ', '<svg id="im_map" style="width:100%;height:220px;border:1px solid var(--line);border-radius:var(--r);display:block" ');
  } catch (e) { console.warn(e); }
}
async function runImport() {
  const rows = IMP.rows.filter(r => r.ok);
  if (!rows.length) return toast('가져올 수 있는 행이 없습니다');
  const target = IMP.target;
  const isPrj = target === 'project';
  const dedup = $('#im_dedup').checked;
  const cap = isPrj ? 400 : 2500;
  if (rows.length > cap && !await confirmBox('많은 양을 가져옵니다',
    `<p><b class="mono">${rows.length}</b>건을 가져오려 합니다. 아티팩트 한 개에 담을 수 있는 문서는 약 5,000개이고 지금 ${S.facilities.length + S.projects.length}개를 쓰고 있습니다.</p>
     <p class="hint">필요한 지역만 걸러 나눠 넣는 편이 안전합니다. 그래도 진행할까요?</p>`, '그대로 가져오기')) return;

  const btn = $('#im_go'); btn.disabled = true;
  const batch = uid();
  const src = { batch, file: IMP.src.label, crs: (IMP.crs || {}).label || '', at: new Date().toISOString() };
  let added = 0, skipped = 0;
  const existing = isPrj ? S.projects : S.facilities.filter(f => f.kind === target);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (dedup && existing.some(e => {
      const d = e.lat == null ? null : haversine(e.lat, e.lng, r.lat, r.lng);
      return d != null && d < 40 && (!r.name || !e.name || e.name === r.name);
    })) { skipped++; continue; }
    if (isPrj) {
      const g = MAP.reverse(r.lat, r.lng);
      const p = {
        id: uid(), name: r.name || '(이름 없음)', marketName: '', aptName: r.name || '',
        sido: g.sido, sgg: g.sgg, address: r.note || '', lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6),
        surveyDate: '', builtYear: r.year && /^\d{4}$/.test(r.year) ? +r.year : null,
        remodel: '미확인', relation: '미분류', status: '미확인', parking: false,
        tags: ['가져옴'], custom: {}, photoCount: 0, noteCount: 0, src,
        note: `가져온 데이터 — ${src.file}`
      };
      await S.store.put('projects', p.id, p);
      S.projects.push(p);
    } else {
      const f = {
        id: uid(), kind: target, name: r.name || '', year: r.year || '',
        note: r.note || '', lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6), src
      };
      if (r.path && r.path.length > 1) f.path = r.path;
      await S.store.put('facilities', f.id, f);
      S.facilities.push(f);
    }
    added++;
    if (i % 25 === 0) { $('#impStat').textContent = `${i + 1} / ${rows.length}…`; await new Promise(r2 => setTimeout(r2, 0)); }
  }
  closeModal();
  MAP.draw(); updateCounts(); renderTable();
  if (S.view === 'set') renderSettings();
  toast(`${added}건 가져왔습니다${skipped ? ` · ${skipped}건은 이미 있어 건너뜀` : ''}`, 4600);
}

/* ---------- 가져온 묶음 관리 ---------- */
function importBatches() {
  const m = new Map();
  for (const list of [S.facilities, S.projects]) {
    for (const d of list) {
      if (!d.src || !d.src.batch) continue;
      const b = m.get(d.src.batch) || { batch: d.src.batch, file: d.src.file, at: d.src.at, crs: d.src.crs, n: 0, kinds: new Set() };
      b.n++; b.kinds.add(d.kind ? FAC_KINDS[d.kind].label : '프로젝트');
      m.set(b.batch, b);
    }
  }
  return Array.from(m.values()).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
async function deleteBatch(batch) {
  const facs = S.facilities.filter(f => f.src && f.src.batch === batch);
  const prjs = S.projects.filter(p => p.src && p.src.batch === batch);
  if (!await confirmBox('가져온 묶음 되돌리기',
    `<p>이 묶음으로 들여온 <b class="mono">${facs.length + prjs.length}</b>건을 삭제합니다.</p>
     <p class="hint">${prjs.length ? `프로젝트 ${prjs.length}건은 휴지통으로 옮겨지며, 사진·기록이 붙어 있다면 함께 보존됩니다. ` : ''}직접 입력한 지점은 건드리지 않습니다.</p>`,
    '되돌리기')) return;
  for (const f of facs) { await S.store.del('facilities', f.id); }
  S.facilities = S.facilities.filter(f => !(f.src && f.src.batch === batch));
  for (const p of prjs) await deleteProject(p.id);
  MAP.draw(); updateCounts(); renderTable(); renderSettings();
  toast(`${facs.length + prjs.length}건을 되돌렸습니다`);
}
