/* ============================================================
   입면 보정 — 4점 원근 보정 · 선 추출 · 내보내기
   ============================================================ */
const EL = { img: null, phId: null, pts: null, out: null, lines: null, dispW: 0, dispH: 0 };

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
    $('#elevSave').disabled = true; $('#elevPng').disabled = true; $('#elevDxf').disabled = true;
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
  $('#elevSave').disabled = false; $('#elevPng').disabled = false; $('#elevDxf').disabled = false;
  $('#elevHint').textContent = `보정 완료 · ${OW}×${OH}px`;
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
    EL.lines = extractLines(bin, W, H);
  } else EL.lines = null;
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
function linesToDxf(lines, H) {
  const e = [];
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
$('#elevEdge').onchange = () => { $('#edgeRow').hidden = !$('#elevEdge').checked; };
['elevSkewX', 'elevContrast', 'elevEdgeT'].forEach(id => {
  const el = $('#' + id), v = $('#v' + id.slice(4));
  el.oninput = () => { if (v) v.textContent = el.value; };
});
$('#elevPng').onclick = () => {
  if (!EL.out) return;
  download('elevation_' + (S.cur || 'image') + '.png', dataUrlToBlob(EL.out.toDataURL('image/png')));
};
$('#elevDxf').onclick = () => {
  if (!EL.out) return;
  if (!EL.lines || !EL.lines.length) return toast('먼저 「선 추출」을 켜고 보정을 실행하세요');
  const m = openModal(`<div class="mh"><h3>선 데이터 내보내기</h3><button class="x">×</button></div>
    <div class="mb"><p>추출된 직선 성분 <b class="mono">${EL.lines.length}</b>개를 CAD에서 쓸 수 있는 형식으로 내보냅니다.</p>
    <p class="hint">사진을 도면으로 자동 변환하는 것이 아니라, 트레이싱의 출발점이 되는 <b>주요 수평·수직선</b>을 선 데이터로 옮기는 기능입니다. 1픽셀 = 1도면단위로 기록됩니다.</p></div>
    <div class="mf"><button class="btn" id="ex_svg">SVG (일러스트·CAD 가져오기)</button><button class="btn pri" id="ex_dxf">DXF</button></div>`);
  $('#ex_svg').onclick = () => { closeModal(); download('elevation_lines.svg', linesToSvg(EL.lines, EL.out.width, EL.out.height), 'image/svg+xml'); };
  $('#ex_dxf').onclick = () => {
    closeModal();
    const txt = linesToDxf(EL.lines, EL.out.height);
    download('elevation_lines_dxf.txt', txt, 'text/plain');
    toast('DXF 텍스트로 저장했습니다 — 확장자를 .dxf로 바꿔 CAD에서 여세요', 5200);
  };
};
$('#elevSave').onclick = async () => {
  const pid = $('#elevPrj').value;
  if (!EL.out || !pid) return;
  const data = EL.out.toDataURL('image/jpeg', 0.88);
  const id = uid();
  const thumb = toJpeg(drawScaled(EL.out, 300), 40000);
  const meta = {
    pid, cat: '입면', kind: 'elevation', caption: '원근 보정 입면', date: today(), place: '', memo: '4점 원근 보정' + ($('#elevEdge').checked ? ' + 선 추출' : ''),
    tags: ['보정'], w: EL.out.width, h: EL.out.height, sharp: 0, size: data.length, createdAt: new Date().toISOString(), thumb
  };
  await S.store.put('photofull', id, { data });
  await S.store.put('photos', id, meta);
  const p = S.projects.find(x => x.id === pid);
  if (p) { p.photoCount = (p.photoCount || 0) + 1; await saveProject(p); }
  toast('프로젝트에 입면 이미지로 저장했습니다');
};
