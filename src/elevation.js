/* ============================================================
   입면 보정 — 4점 원근 보정 · 선 추출 · 내보내기
   ============================================================ */
const EL = { img: null, phId: null, pts: null, out: null, lines: null, raw: null, bin: null, ops: [], dispW: 0, dispH: 0 };

async function download(filename, data, mime) {
  if (S.downloads) {
    try { await S.downloads.save({ filename, data }); toast('저장했습니다'); return; }
    catch (e) {
      if (e && e.code === 'declined') return;
      console.warn(e);
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('내려받기를 시작했습니다');
  } catch (e) { toast('이 환경에서는 파일 저장을 지원하지 않습니다'); }
}
function dataUrlToBlob(u) {
  const [h, b] = u.split(','); const mime = h.match(/:(.*?);/)[1];
  const bin = atob(b); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function renderElevPicker() {
  const sel = $('#elevPrj');
  const cur = sel.value || S.cur || (S.projects[0] && S.projects[0].id) || '';
  sel.innerHTML = S.projects.map(p => `<option value="${p.id}">${esc(projName(p))}</option>`).join('') || '<option value="">프로젝트 없음</option>';
  sel.value = cur;
  sel.onchange = () => loadStrip(sel.value);
  loadStrip(sel.value);
}
async function loadStrip(pid) {
  const strip = $('#elevStrip');
  if (!pid) { strip.innerHTML = '<p class="hint">먼저 프로젝트를 만들고 건물 사진을 올려주세요.</p>'; return; }
  const photos = await S.store.list('photos', ['pid', '==', pid]);
  const cand = photos.filter(p => p.kind !== 'elevation');
  if (!cand.length) { strip.innerHTML = '<p class="hint">이 프로젝트에 사진이 없습니다. 프로젝트 상세에서 사진을 올리세요.</p>'; return; }
  // 같은 면끼리 묶고(입면 방향 태그), 선명도·해상도 순으로 추천 정렬
  const groups = {};
  cand.forEach(p => { const k = p.face || (p.cat === '입면' ? '입면(방향 미지정)' : '기타'); (groups[k] = groups[k] || []).push(p); });
  const score = p => (p.sharp || 0) * 0.6 + Math.min(3000, Math.max(p.w, p.h)) * 0.12 + (p.cat === '입면' ? 300 : 0);
  strip.innerHTML = Object.entries(groups).map(([g, arr]) => {
    arr.sort((a, b) => score(b) - score(a));
    return `<div style="flex:none"><div class="hint mono" style="font-size:10px;margin-bottom:3px">${esc(g)} · ${arr.length}</div>
      <div style="display:flex;gap:6px">${arr.map((p, i) => `<div class="ph" data-el="${p.id}" style="width:96px;flex:none;aspect-ratio:4/3">
        <img src="${p.thumb}" alt=""><span class="badge">${i === 0 ? '추천' : '선명도 ' + (p.sharp || 0)}</span></div>`).join('')}</div></div>`;
  }).join('');
  $$('#elevStrip [data-el]').forEach(e => e.onclick = () => loadElevPhoto(e.dataset.el));
}
async function loadElevPhoto(id) {
  const meta = await S.store.get('photos', id);
  const full = await S.store.get('photofull', id);
  if (!full) return toast('원본 이미지를 찾을 수 없습니다');
  if (meta && meta.pid) { $('#elevPrj').value = meta.pid; }
  const img = new Image();
  img.onload = () => {
    EL.img = img; EL.phId = id;
    const cv = $('#elevcv');
    const stage = $('#elevstage').getBoundingClientRect();
    const maxW = Math.max(200, stage.width - 24), maxH = Math.max(200, stage.height - 24);
    const r = Math.min(maxW / img.width, maxH / img.height, 1);
    cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
    EL.dispW = cv.width; EL.dispH = cv.height;
    EL.pts = [[.12, .10], [.88, .10], [.88, .92], [.12, .92]];
    drawElevSource();
    placeHandles();
    EL.out = null; EL.lines = null; EL.raw = null; EL.ops = [];
    $$('#elevExport button').forEach(b => b.disabled = true);
    renderLineOps();
    $('#elevHint').textContent = '네 점을 건물 입면의 모서리로 옮긴 뒤 「보정 실행」';
  };
  img.src = full.data;
}
function drawElevSource() {
  const cv = $('#elevcv'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(EL.img, 0, 0, cv.width, cv.height);
  if (!EL.pts) return;
  ctx.save();
  ctx.strokeStyle = '#C2472C'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
  ctx.beginPath();
  EL.pts.forEach((p, i) => { const x = p[0] * cv.width, y = p[1] * cv.height; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}
function placeHandles() {
  const cv = $('#elevcv'), box = $('#handles');
  const stage = $('#elevstage').getBoundingClientRect(), r = cv.getBoundingClientRect();
  const ox = r.left - stage.left, oy = r.top - stage.top;
  box.innerHTML = EL.pts.map((p, i) => `<div class="handle" data-h="${i}" style="left:${ox + p[0] * r.width}px;top:${oy + p[1] * r.height}px"><b></b><span>${['좌상', '우상', '우하', '좌하'][i]}</span></div>`).join('');
  $$('#handles .handle').forEach(h => {
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const move = ev => {
        const rc = $('#elevcv').getBoundingClientRect();
        const nx = Math.max(0, Math.min(1, (ev.clientX - rc.left) / rc.width));
        const ny = Math.max(0, Math.min(1, (ev.clientY - rc.top) / rc.height));
        EL.pts[+h.dataset.h] = [nx, ny];
        h.style.left = (rc.left - $('#elevstage').getBoundingClientRect().left + nx * rc.width) + 'px';
        h.style.top = (rc.top - $('#elevstage').getBoundingClientRect().top + ny * rc.height) + 'px';
        drawElevSource();
      };
      const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
    });
  });
}
/* 8x8 선형계 풀이 (가우스 소거) */
function solve8(A, b) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    let mx = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[mx][i])) mx = k;
    [A[i], A[mx]] = [A[mx], A[i]];[b[i], b[mx]] = [b[mx], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}
/** dst(정면) → src(사진) 호모그래피 */
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], [x, y] = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  return solve8(A, b);
}
function applyElev() {
  if (!EL.img || !EL.pts) return toast('먼저 사진을 선택하세요');
  const iw = EL.img.width, ih = EL.img.height;
  const src = EL.pts.map(p => [p[0] * iw, p[1] * ih]);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const wAvg = (d(src[0], src[1]) + d(src[3], src[2])) / 2;
  const hAvg = (d(src[0], src[3]) + d(src[1], src[2])) / 2;
  const sel = $('#elevRatio').value;
  const ratio = sel === 'auto' ? Math.max(.2, Math.min(6, wAvg / Math.max(1, hAvg))) : +sel;
  let OW = Math.min(1600, Math.max(400, Math.round(wAvg)));
  let OH = Math.round(OW / ratio);
  if (OH > 1600) { OH = 1600; OW = Math.round(OH * ratio); }
  const dst = [[0, 0], [OW, 0], [OW, OH], [0, OH]];
  const H = homography(dst, src);
  if (!H) return toast('네 점이 한 직선 위에 있습니다 — 위치를 조정하세요');
  const sc = document.createElement('canvas'); sc.width = iw; sc.height = ih;
  sc.getContext('2d').drawImage(EL.img, 0, 0);
  const sd = sc.getContext('2d').getImageData(0, 0, iw, ih).data;
  const out = document.createElement('canvas'); out.width = OW; out.height = OH;
  const octx = out.getContext('2d');
  const od = octx.createImageData(OW, OH);
  const ang = (+$('#elevSkewX').value) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const cx = OW / 2, cy = OH / 2;
  for (let v = 0; v < OH; v++) {
    for (let u = 0; u < OW; u++) {
      const rx = (u - cx) * ca - (v - cy) * sa + cx;
      const ry = (u - cx) * sa + (v - cy) * ca + cy;
      const w = H[6] * rx + H[7] * ry + 1;
      const x = (H[0] * rx + H[1] * ry + H[2]) / w;
      const y = (H[3] * rx + H[4] * ry + H[5]) / w;
      const o = (v * OW + u) * 4;
      if (x < 0 || y < 0 || x >= iw - 1 || y >= ih - 1) { od.data[o + 3] = 0; continue; }
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * iw + x0) * 4, i10 = i00 + 4, i01 = i00 + iw * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        od.data[o + ch] = sd[i00 + ch] * (1 - fx) * (1 - fy) + sd[i10 + ch] * fx * (1 - fy) + sd[i01 + ch] * (1 - fx) * fy + sd[i11 + ch] * fx * fy;
      }
      od.data[o + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  postProcess(out);
  EL.out = out;
  showResult();
  $$('#elevExport button').forEach(b => b.disabled = false);
  $('#elevHint').textContent = `보정 완료 · ${OW}×${OH}px` + (EL.lines ? ` · 선 ${EL.lines.length}개` : '');
  renderLineOps();
}
function postProcess(cv) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  const im = ctx.getImageData(0, 0, W, H), d = im.data;
  const gray = $('#elevGray').checked, edge = $('#elevEdge').checked;
  const k = +$('#elevContrast').value;
  const f = (259 * (k + 255)) / (255 * (259 - k));
  for (let i = 0; i < d.length; i += 4) {
    let r = f * (d[i] - 128) + 128, g = f * (d[i + 1] - 128) + 128, b = f * (d[i + 2] - 128) + 128;
    if (gray || edge) { const y = r * .299 + g * .587 + b * .114; r = g = b = y; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(im, 0, 0);
  if (edge) {
    const t = +$('#elevEdgeT').value;
    const g = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = d[i * 4];
    const o = ctx.createImageData(W, H);
    o.data.fill(252);
    for (let i = 3; i < o.data.length; i += 4) o.data[i] = 255;
    const bin = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] + g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
      const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
      const m = Math.hypot(gx, gy) / 4;
      const on = m > t;
      bin[i] = on ? 1 : 0;
      const v = on ? 20 : 252;
      o.data[i * 4] = o.data[i * 4 + 1] = o.data[i * 4 + 2] = v; o.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(o, 0, 0);
    EL.bin = { bin, W, H };
    EL.raw = extractLines(bin, W, H);
    EL.lines = EL.raw.slice();
    EL.ops = [];
  } else { EL.lines = null; EL.raw = null; EL.bin = null; EL.ops = []; }
}
/** 이진 엣지에서 수평·수직 직선 성분 추출 */
function extractLines(bin, W, H) {
  const minH = Math.max(24, W * 0.06), minV = Math.max(24, H * 0.06), gap = 3;
  const out = [];
  const scan = (len, cross, get, mk, minLen) => {
    const used = [];
    for (let c = 0; c < cross; c++) {
      let run = 0, start = 0, miss = 0;
      for (let i = 0; i <= len; i++) {
        const on = i < len && get(c, i);
        if (on) { if (!run) start = i; run++; miss = 0; }
        else if (run) {
          miss++;
          if (miss > gap || i === len) {
            const L = i - miss - start;
            if (L >= minLen) {
              const key = mk(c, start, start + L);
              const dup = used.find(u => Math.abs(u[0] - key[0]) < 4 && Math.abs(u[1] - key[1]) < 12);
              if (!dup) { used.push(key); out.push(key[2]); }
            }
            run = 0; miss = 0;
          }
        }
      }
    }
  };
  scan(W, H, (y, x) => bin[y * W + x], (y, x0, x1) => [y, x0, [x0, y, x1, y]], minH);
  scan(H, W, (x, y) => bin[y * W + x], (x, y0, y1) => [x, y0, [x, y0, x, y1]], minV);
  return out;
}
function showResult() {
  const cv = $('#elevcv'), ctx = cv.getContext('2d');
  const stage = $('#elevstage').getBoundingClientRect();
  const maxW = Math.max(200, stage.width - 24), maxH = Math.max(200, stage.height - 24);
  const r = Math.min(maxW / EL.out.width, maxH / EL.out.height, 1);
  cv.width = Math.round(EL.out.width * r); cv.height = Math.round(EL.out.height * r);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(EL.out, 0, 0, cv.width, cv.height);
  if (EL.lines && EL.lines.length && $('#elevOverlay') && $('#elevOverlay').checked) {
    const k = cv.width / EL.out.width;
    ctx.save(); ctx.strokeStyle = '#C2472C'; ctx.lineWidth = 1.2;
    for (const l of EL.lines) { ctx.beginPath(); ctx.moveTo(l[0] * k, l[1] * k); ctx.lineTo(l[2] * k, l[3] * k); ctx.stroke(); }
    ctx.restore();
  }
  if ($('#elevGrid').checked) {
    ctx.save(); ctx.strokeStyle = 'rgba(20,71,125,.45)'; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(cv.width * i / 8, 0); ctx.lineTo(cv.width * i / 8, cv.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cv.height * i / 8); ctx.lineTo(cv.width, cv.height * i / 8); ctx.stroke();
    }
    ctx.restore();
  }
  $('#handles').innerHTML = '';
}

/* ============================================================
   입면도 제작 보조 — 추출한 선을 연구자의 지시대로 다듬는다.

   여기서 하는 일은 "사진의 자동 도면화"가 아니다. 원근을 편 이미지에서 뽑아낸
   수평·수직 선분을 대상으로, 트레이싱에 방해가 되는 것을 걷어내고
   층 경계·창호·외곽선 같은 건축적으로 의미 있는 선만 남기는 편집이다.
   모든 연산은 EL.raw(최초 추출 결과)에서 다시 계산하므로 언제든 되돌릴 수 있다.
   ============================================================ */
const isH = l => l[1] === l[3];
const lineLen = l => isH(l) ? Math.abs(l[2] - l[0]) : Math.abs(l[3] - l[1]);
function inkBox(lines, W, H) {
  if (!lines.length) return [0, 0, W, H];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const l of lines) { x0 = Math.min(x0, l[0], l[2]); x1 = Math.max(x1, l[0], l[2]); y0 = Math.min(y0, l[1], l[3]); y1 = Math.max(y1, l[1], l[3]); }
  return [x0, y0, x1, y1];
}
/** 같은 축 위의 조각난 선분을 하나로 잇는다 */
function mergeLines(lines, tol, gap) {
  const out = [];
  for (const horiz of [true, false]) {
    const set = lines.filter(l => isH(l) === horiz);
    const key = l => horiz ? l[1] : l[0];
    const lo = l => horiz ? Math.min(l[0], l[2]) : Math.min(l[1], l[3]);
    const hi = l => horiz ? Math.max(l[0], l[2]) : Math.max(l[1], l[3]);
    set.sort((a, b) => key(a) - key(b) || lo(a) - lo(b));
    const bands = [];
    for (const l of set) {
      const b = bands.find(b => Math.abs(b.k - key(l)) <= tol);
      if (b) { b.items.push(l); b.k = (b.k * (b.items.length - 1) + key(l)) / b.items.length; }
      else bands.push({ k: key(l), items: [l] });
    }
    for (const b of bands) {
      const segs = b.items.map(l => [lo(l), hi(l)]).sort((a, b2) => a[0] - b2[0]);
      let cur = segs[0].slice();
      for (let i = 1; i < segs.length; i++) {
        if (segs[i][0] - cur[1] <= gap) cur[1] = Math.max(cur[1], segs[i][1]);
        else { out.push(mk(horiz, Math.round(b.k), cur)); cur = segs[i].slice(); }
      }
      out.push(mk(horiz, Math.round(b.k), cur));
    }
  }
  return out;
  function mk(horiz, k, seg) { return horiz ? [Math.round(seg[0]), k, Math.round(seg[1]), k] : [k, Math.round(seg[0]), k, Math.round(seg[1])]; }
}
const LINE_OPS = {
  simplify: {
    label: '선 단순화', hint: '끊긴 선을 잇고 짧은 조각을 지웁니다',
    run(lines, W, H) { return mergeLines(lines, 4, 14).filter(l => lineLen(l) >= (isH(l) ? W : H) * 0.045); }
  },
  denoise: {
    label: '짧은 선 제거', hint: '길이가 짧은 잡선을 걷어냅니다',
    run(lines, W, H) { return lines.filter(l => lineLen(l) >= (isH(l) ? W : H) * 0.12); }
  },
  outline: {
    label: '건물 외곽선', hint: '외곽 사각형과 전체를 가로지르는 선만 남깁니다',
    run(lines, W, H) {
      const [x0, y0, x1, y1] = inkBox(lines, W, H);
      const box = [[x0, y0, x1, y0], [x0, y1, x1, y1], [x0, y0, x0, y1], [x1, y0, x1, y1]].map(l => l.map(Math.round));
      const span = lines.filter(l => lineLen(l) >= (isH(l) ? (x1 - x0) : (y1 - y0)) * 0.86);
      return box.concat(span);
    }
  },
  floors: {
    label: '층 경계선', hint: '폭의 절반 이상을 가로지르는 수평선을 층 경계로 봅니다',
    run(lines, W, H) {
      const [x0, y0, x1, y1] = inkBox(lines, W, H);
      const wide = mergeLines(lines.filter(isH), 5, 30).filter(l => lineLen(l) >= (x1 - x0) * 0.5);
      const bands = [];
      for (const l of wide.sort((a, b) => a[1] - b[1])) {
        const b = bands.find(b => Math.abs(b - l[1]) < Math.max(8, (y1 - y0) * 0.02));
        if (b == null) bands.push(l[1]);
      }
      return bands.map(y => [Math.round(x0), Math.round(y), Math.round(x1), Math.round(y)]);
    }
  },
  windows: {
    label: '창호 구분', hint: '반복되는 수직선 쌍을 창호 사각형으로 표시합니다',
    run(lines, W, H) {
      const v = lines.filter(l => !isH(l) && lineLen(l) >= H * 0.03 && lineLen(l) <= H * 0.34)
        .map(l => ({ x: l[0], a: Math.min(l[1], l[3]), b: Math.max(l[1], l[3]) }))
        .sort((p, q) => p.a - q.a || p.x - q.x);
      const out = [];
      for (let i = 0; i < v.length && out.length < 1600; i++) {
        for (let j = i + 1; j < v.length; j++) {
          if (v[j].a > v[i].b) break;
          const gapX = v[j].x - v[i].x;
          if (gapX < W * 0.012 || gapX > W * 0.18) continue;
          const a = Math.max(v[i].a, v[j].a), b = Math.min(v[i].b, v[j].b);
          const ov = b - a;
          if (ov < Math.min(v[i].b - v[i].a, v[j].b - v[j].a) * 0.6) continue;
          const ratio = ov / gapX;
          if (ratio < 0.5 || ratio > 4.5) continue;      // 창으로 보기 어려운 비율은 버린다
          out.push([v[i].x, a, v[j].x, a], [v[i].x, b, v[j].x, b], [v[i].x, a, v[i].x, b], [v[j].x, a, v[j].x, b]);
          break;
        }
      }
      return out;
    }
  },
  nosign: {
    label: '간판 영역 정리', hint: '아래쪽 간판대의 잡선을 지우고 층 경계선은 남깁니다',
    run(lines, W, H) {
      const [x0, y0, x1, y1] = inkBox(lines, W, H);
      const cut = y1 - (y1 - y0) * 0.24;
      return lines.filter(l => {
        const my = (l[1] + l[3]) / 2;
        if (my < cut) return true;
        return isH(l) ? lineLen(l) >= (x1 - x0) * 0.55 : lineLen(l) >= (y1 - y0) * 0.5;
      });
    }
  },
  vertical: { label: '수직선만', hint: '수직 부재만 남깁니다', run(lines) { return lines.filter(l => !isH(l)); } },
  horizontal: { label: '수평선만', hint: '수평 부재만 남깁니다', run(lines) { return lines.filter(isH); } }
};
/** 지시 목록을 EL.raw 부터 차례로 적용한다 (되돌리기가 항상 가능하도록) */
function applyLineOps(ops) {
  if (!EL.raw || !EL.out) return;
  let ls = EL.raw.slice();
  for (const k of ops) { const op = LINE_OPS[k]; if (op) ls = op.run(ls, EL.out.width, EL.out.height); }
  EL.lines = ls; EL.ops = ops.slice();
  showResult(); renderLineOps();
  $('#elevHint').textContent = `보정 완료 · ${EL.out.width}×${EL.out.height}px · 선 ${EL.lines.length}개`;
}
function renderLineOps() {
  const box = $('#lineops'); if (!box) return;
  if (!EL.raw) { box.innerHTML = '<p class="hint">「선 추출」을 켜고 보정을 실행하면 이곳에서 선을 다듬을 수 있습니다.</p>'; return; }
  box.innerHTML = `
    <p class="hint" style="margin:0 0 8px">추출된 선 <b class="mono">${EL.raw.length}</b>개 → 현재 <b class="mono">${(EL.lines || []).length}</b>개.
    아래 지시는 순서대로 적용되며, 원본 추출 결과는 그대로 보관됩니다.</p>
    <div style="display:flex;gap:5px;flex-wrap:wrap">
      ${Object.entries(LINE_OPS).map(([k, o]) => `<button class="chip" data-op="${k}" title="${esc(o.hint)}" aria-pressed="${EL.ops.includes(k)}">${esc(o.label)}</button>`).join('')}
    </div>
    ${EL.ops.length ? `<p class="hint mono" style="margin:8px 0 0">적용: ${EL.ops.map(k => LINE_OPS[k].label).join(' → ')}</p>` : ''}
    <input type="text" id="elevCmd" style="margin-top:8px" placeholder="예) 간판은 지우고 층 경계선만 남겨줘">
    <div style="display:flex;gap:6px;margin-top:6px">
      <button class="btn sm pri" id="elevCmdGo" style="flex:1;justify-content:center">지시 실행</button>
      <button class="btn sm" id="elevOpsReset" style="flex:1;justify-content:center">원래대로</button></div>
    <p class="hint" style="margin:6px 0 0">${S.sample ? 'AI가 문장을 해석해 위 연산으로 옮깁니다.' : '낱말(간판·층·창·외곽·단순화)로 해석합니다.'}</p>`;
  $$('#lineops [data-op]').forEach(b => b.onclick = () => {
    const k = b.dataset.op;
    const ops = EL.ops.includes(k) ? EL.ops.filter(x => x !== k) : EL.ops.concat([k]);
    applyLineOps(ops);
  });
  $('#elevOpsReset').onclick = () => applyLineOps([]);
  $('#elevCmdGo').onclick = () => runElevCommand($('#elevCmd').value);
  $('#elevCmd').onkeydown = e => { if (e.key === 'Enter') runElevCommand(e.target.value); };
}
/** 한국어 지시 → 연산 목록. AI를 쓸 수 있으면 해석을 맡기고, 없으면 낱말로 고른다. */
const CMD_WORDS = [
  [/간판|사인|광고/, 'nosign'], [/층|경계|바닥|슬래브/, 'floors'], [/창|창호|창문|개구부/, 'windows'],
  [/외곽|윤곽|테두리|형태만|매스/, 'outline'], [/단순|정리|깔끔|트레이싱/, 'simplify'],
  [/잡선|노이즈|짧은|지저분/, 'denoise'], [/수직|기둥/, 'vertical'], [/수평|보|가로선/, 'horizontal']
];
async function runElevCommand(q) {
  q = (q || '').trim();
  if (!q) return;
  if (!EL.raw) return toast('먼저 「선 추출」을 켜고 보정을 실행하세요');
  const local = () => {
    const ops = [];
    for (const [re, k] of CMD_WORDS) if (re.test(q) && !ops.includes(k)) ops.push(k);
    return ops;
  };
  let ops = null;
  if (S.sample) {
    $('#elevCmdGo').disabled = true; $('#elevCmdGo').textContent = '해석 중';
    try {
      const names = Object.entries(LINE_OPS).map(([k, o]) => `${k} = ${o.label} (${o.hint})`).join('\n');
      const r = await S.sample(`건축 입면 트레이싱 보조 도구의 명령 해석기입니다.
사용 가능한 연산:
${names}

연구자의 지시: "${q}"

지시를 수행할 연산 키를 적용 순서대로 골라 JSON 배열로만 답하세요. 예: ["nosign","floors"]
해당하는 연산이 없으면 [] 을 반환하세요. 설명이나 다른 문장은 쓰지 마세요.`);
      const m = String(r.text || '').match(/\[[\s\S]*?\]/);
      if (m) ops = JSON.parse(m[0]).filter(k => LINE_OPS[k]);
    } catch (e) { console.warn(e); }
    $('#elevCmdGo').disabled = false; $('#elevCmdGo').textContent = '지시';
  }
  if (!ops || !ops.length) ops = local();
  if (!ops.length) return toast('해석하지 못했습니다 — 위의 버튼으로 직접 골라주세요', 3600);
  applyLineOps(ops);
  toast('적용: ' + ops.map(k => LINE_OPS[k].label).join(' → '), 3200);
}

/* ============================================================
   내보내기 — PNG · JPG · PDF · SVG · DXF
   ============================================================ */
function linesToDxf(lines, W, H) {
  const e = [];
  // R12(AC1009) 최소 구성. 1픽셀 = 1도면단위, 원점은 좌하단.
  e.push('999', '시장아파트 답사 아카이브 — 입면 트레이싱 베이스');
  e.push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009',
    '9', '$EXTMIN', '10', '0.0', '20', '0.0', '9', '$EXTMAX', '10', W.toFixed(1), '20', H.toFixed(1), '0', 'ENDSEC');
  e.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1',
    '0', 'LAYER', '2', 'ELEVATION', '70', '0', '62', '7', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC');
  e.push('0', 'SECTION', '2', 'ENTITIES');
  for (const [x0, y0, x1, y1] of lines) {
    e.push('0', 'LINE', '8', 'ELEVATION', '10', x0.toFixed(2), '20', (H - y0).toFixed(2), '30', '0.0',
      '11', x1.toFixed(2), '21', (H - y1).toFixed(2), '31', '0.0');
  }
  e.push('0', 'ENDSEC', '0', 'EOF');
  return e.join('\n');
}
function linesToSvg(lines, W, H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
${lines.map(l => `<line x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}" stroke="#111111" stroke-width="1"/>`).join('\n')}
</svg>`;
}
/** 이미지(+선)를 한 장짜리 PDF로. 선은 벡터로 들어가 일러스트레이터에서 그대로 열린다. */
function buildPdf(jpegDataUrl, W, H, lines) {
  const enc = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const jpg = jpegDataUrl ? new Uint8Array(atob(jpegDataUrl.split(',')[1]).split('').map(c => c.charCodeAt(0))) : null;
  let content = '';
  if (jpg) content += `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;
  if (lines && lines.length) {
    content += `0.15 w 0.10 0.10 0.10 RG\n`;
    for (const l of lines) content += `${l[0]} ${(H - l[1]).toFixed(1)} m ${l[2]} ${(H - l[3]).toFixed(1)} l S\n`;
  }
  const objs = [];
  objs[1] = enc('<</Type/Catalog/Pages 2 0 R>>');
  objs[2] = enc('<</Type/Pages/Kids[3 0 R]/Count 1>>');
  objs[3] = enc(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<<${jpg ? '/XObject<</Im0 4 0 R>>' : ''}>>/Contents 5 0 R>>`);
  if (jpg) {
    const head = enc(`<</Type/XObject/Subtype/Image/Width ${W}/Height ${H}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpg.length}>>\nstream\n`);
    const tail = enc('\nendstream');
    const b = new Uint8Array(head.length + jpg.length + tail.length);
    b.set(head, 0); b.set(jpg, head.length); b.set(tail, head.length + jpg.length);
    objs[4] = b;
  } else objs[4] = enc('<</Type/XObject>>');
  const cs = enc(content);
  const ch = enc(`<</Length ${cs.length}>>\nstream\n`), ct = enc('\nendstream');
  const cb = new Uint8Array(ch.length + cs.length + ct.length);
  cb.set(ch, 0); cb.set(cs, ch.length); cb.set(ct, ch.length + cs.length);
  objs[5] = cb;

  const chunks = [enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let pos = chunks[0].length;
  const offs = [];
  for (let i = 1; i <= 5; i++) {
    offs[i] = pos;
    const head = enc(`${i} 0 obj\n`), tail = enc('\nendobj\n');
    chunks.push(head, objs[i], tail);
    pos += head.length + objs[i].length + tail.length;
  }
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${pos}\n%%EOF\n`;
  chunks.push(enc(xref));
  return new Blob(chunks, { type: 'application/pdf' });
}
function elevBaseName() {
  const p = S.projects.find(x => x.id === $('#elevPrj').value);
  return (p ? projName(p) : '입면').replace(/[\\/:*?"<>|]/g, '_') + '_입면_' + today();
}
function needOut() { if (!EL.out) { toast('먼저 보정을 실행하세요'); return false; } return true; }
function needLines() {
  if (!EL.lines || !EL.lines.length) { toast('먼저 「선 추출」을 켜고 보정을 실행하세요'); return false; }
  return true;
}
$('#elevApply').onclick = () => { try { applyElev(); } catch (e) { console.error(e); toast('보정에 실패했습니다'); } };
$('#elevReset').onclick = () => {
  if (!EL.img) return toast('먼저 사진을 선택하세요');
  const cv = $('#elevcv');
  const stage = $('#elevstage').getBoundingClientRect();
  const r = Math.min((stage.width - 24) / EL.img.width, (stage.height - 24) / EL.img.height, 1);
  cv.width = Math.round(EL.img.width * r); cv.height = Math.round(EL.img.height * r);
  drawElevSource(); placeHandles();
};
$('#elevGrid').onchange = () => { if (EL.out) showResult(); };
$('#elevOverlay').onchange = () => { if (EL.out) showResult(); };
$('#elevEdge').onchange = () => { $('#edgeRow').hidden = !$('#elevEdge').checked; };
['elevSkewX', 'elevContrast', 'elevEdgeT'].forEach(id => {
  const el = $('#' + id), v = $('#v' + id.slice(4));
  el.oninput = () => { if (v) v.textContent = el.value; };
});
$('#elevPng').onclick = () => { if (needOut()) download(elevBaseName() + '.png', dataUrlToBlob(EL.out.toDataURL('image/png'))); };
$('#elevJpg').onclick = () => { if (needOut()) download(elevBaseName() + '.jpg', dataUrlToBlob(EL.out.toDataURL('image/jpeg', 0.92))); };
$('#elevPdf').onclick = () => {
  if (!needOut()) return;
  const withLines = EL.lines && EL.lines.length;
  download(elevBaseName() + '.pdf', buildPdf(EL.out.toDataURL('image/jpeg', 0.9), EL.out.width, EL.out.height, withLines ? EL.lines : null));
  toast(withLines ? '보정 이미지 위에 추출한 선을 벡터로 얹어 저장했습니다' : '보정 이미지를 PDF로 저장했습니다', 3800);
};
$('#elevSvg').onclick = () => { if (needLines()) download(elevBaseName() + '_선.svg', linesToSvg(EL.lines, EL.out.width, EL.out.height), 'image/svg+xml'); };
$('#elevDxf').onclick = () => {
  if (!needLines()) return;
  openModal(`<div class="mh"><h3>선 데이터 DXF 내보내기</h3><button class="x">×</button></div>
    <div class="mb"><p>다듬어진 직선 성분 <b class="mono">${EL.lines.length}</b>개를 CAD에서 쓸 수 있는 DXF(R12)로 내보냅니다.</p>
    <p class="hint">사진을 도면으로 자동 변환하는 것이 아니라, 트레이싱의 출발점이 되는 <b>외곽선·층 경계·수직/수평 부재</b>를 선 데이터로 옮기는 기능입니다.
    1픽셀 = 1도면단위, 원점은 이미지 좌하단, 레이어명은 <span class="mono">ELEVATION</span> 입니다.</p></div>
    <div class="mf"><button class="btn" id="ex_svg">SVG로</button><button class="btn pri" id="ex_dxf">DXF 내려받기</button></div>`);
  $('#ex_svg').onclick = () => { closeModal(); $('#elevSvg').click(); };
  $('#ex_dxf').onclick = () => {
    closeModal();
    download(elevBaseName() + '.dxf', linesToDxf(EL.lines, EL.out.width, EL.out.height), 'application/dxf');
  };
};
$('#elevSave').onclick = async () => {
  const pid = $('#elevPrj').value;
  if (!EL.out || !pid) return;
  const data = EL.out.toDataURL('image/jpeg', 0.88);
  const id = uid();
  const thumb = toJpeg(drawScaled(EL.out, 300), 40000);
  const meta = {
    pid, cat: '입면', kind: 'elevation', caption: '원근 보정 입면', date: today(), place: '',
    memo: '4점 원근 보정' + ($('#elevEdge').checked ? ' + 선 추출' : '') + (EL.ops.length ? ' · ' + EL.ops.map(k => LINE_OPS[k].label).join(' → ') : ''),
    tags: ['보정'], w: EL.out.width, h: EL.out.height, sharp: 0, size: data.length, createdAt: new Date().toISOString(), thumb
  };
  try {
    await putRetry('photofull', id, { data });
    await putRetry('photos', id, meta);
  } catch (e) {
    try { await S.store.del('photofull', id); } catch (e2) { }
    return toast('저장하지 못했습니다: ' + String((e && (e.message || e.code)) || e), 5000);
  }
  const p = S.projects.find(x => x.id === pid);
  if (p) { p.photoCount = (p.photoCount || 0) + 1; await saveProject(p); }
  toast('프로젝트에 입면 이미지로 저장했습니다');
};
