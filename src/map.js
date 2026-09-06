/* ============================================================
   지도 엔진 — 국토지리 경계 SVG + 팬/줌 + 마커 레이어
   ============================================================ */
const KX = Math.cos(36 * Math.PI / 180);
const w2x = lng => lng * KX, w2y = lat => -lat;

function decodeRings(f) {
  return f.r.map(arr => {
    const pts = []; let px = 0, py = 0;
    for (let i = 0; i < arr.length; i += 2) { px += arr[i]; py += arr[i + 1]; pts.push([px / 10000, py / 10000]); }
    return pts;
  });
}
function ringsToPath(rings) {
  let d = '';
  for (const r of rings) {
    d += 'M' + r.map(p => w2x(p[0]).toFixed(4) + ' ' + w2y(p[1]).toFixed(4)).join('L') + 'Z';
  }
  return d;
}
function ringCenter(rings) {
  let best = null, ba = -1;
  for (const r of rings) {
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const p of r) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
    const a = (maxx - minx) * (maxy - miny);
    if (a > ba) { ba = a; best = [(minx + maxx) / 2, (miny + maxy) / 2]; }
  }
  return best;
}
function pointInRings(lng, lat, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
  }
  return inside;
}

const MAP = {
  svg: null, s: 1, tx: 0, ty: 0, W: 0, H: 0,
  sido: [], sgg: [], picking: false, pickCb: null, radius: 0,
  drawing: null, draft: [], dragging: false,
  layers: { apt: 1, station: 1, oldstation: 1, terminal: 1, market: 1, rail: 1, oldrail: 1 },
  init() {
    const G = window.KRGEO;
    this.sido = G.sido.map(f => { const rings = decodeRings(f); return { n: f.n, c: f.c, d: ringsToPath(rings), ct: ringCenter(rings) }; });
    this.sgg = G.sgg.map(f => { const rings = decodeRings(f); return { n: f.n, c: f.c, rings, d: ringsToPath(rings), ct: ringCenter(rings) }; });
    this.svg = $('#mapsvg');
    this.svg.innerHTML = `<g id="gLand"></g><g id="gSgg"></g><g id="gRadius"></g><g id="gLbl"></g><g id="gMk"></g>`;
    $('#gLand').innerHTML = this.sido.map(f => `<path class="sido-path" d="${f.d}"></path>`).join('');
    $('#gSgg').innerHTML = this.sgg.map(f => `<path class="sgg-path" d="${f.d}"></path>`).join('');
    this.buildLayerUI();
    this.bind();
    this.resize();
    this.fit();
  },
  buildLayerUI() {
    $('#layerlist').innerHTML = Object.entries(FAC_KINDS).map(([k, v]) => {
      const n = k === 'apt' ? S.projects.length : S.facilities.filter(f => f.kind === k).length;
      const sw = v.shape === 'ci-o' || v.shape === 'ln-d'
        ? `border:1.5px dashed ${v.color};background:transparent`
        : `background:${v.color}`;
      return `<label class="lyr"><input type="checkbox" data-lyr="${k}" ${this.layers[k] ? 'checked' : ''}>
        <span class="swatch" style="${sw};${v.shape === 'ci' || v.shape === 'ci-o' ? 'border-radius:50%' : ''}"></span>
        <span>${v.label}</span><span class="n">${n}</span></label>`;
    }).join('');
    $$('[data-lyr]').forEach(i => i.onchange = () => { this.layers[i.dataset.lyr] = i.checked; this.draw(); });
    $$('input[name=rad]').forEach(i => i.onchange = () => { this.radius = +i.value; this.draw(); });
  },
  resize() {
    const r = $('#mapwrap').getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    this.apply();
  },
  fit() {
    const b = { x0: w2x(124.4), x1: w2x(131.1), y0: w2y(38.8), y1: w2y(33.0) };
    const s = Math.min(this.W / (b.x1 - b.x0), this.H / (b.y1 - b.y0)) * 0.94;
    this.s = s;
    this.tx = this.W / 2 - ((b.x0 + b.x1) / 2) * s;
    this.ty = this.H / 2 - ((b.y0 + b.y1) / 2) * s;
    this.apply(); this.draw();
  },
  toScreen(lat, lng) { return [w2x(lng) * this.s + this.tx, w2y(lat) * this.s + this.ty]; },
  toLatLng(px, py) { return [-((py - this.ty) / this.s), ((px - this.tx) / this.s) / KX]; },
  apply() {
    const t = `translate(${this.tx.toFixed(2)},${this.ty.toFixed(2)}) scale(${this.s.toFixed(4)})`;
    $('#gLand').setAttribute('transform', t);
    $('#gSgg').setAttribute('transform', t);
    $$('#gSgg .sgg-path').forEach(p => p.classList.toggle('show', this.s > 4200));
    this.drawLabels(); this.drawMarkers(); this.scalebar();
  },
  zoomAt(px, py, k) {
    const ns = Math.max(300, Math.min(900000, this.s * k));
    const r = ns / this.s;
    this.tx = px - (px - this.tx) * r; this.ty = py - (py - this.ty) * r; this.s = ns;
    this.apply();
  },
  scalebar() {
    const [lat] = this.toLatLng(this.W / 2, this.H / 2);
    const mPerPx = 111320 * Math.cos(lat * Math.PI / 180) / (this.s * KX);
    const targets = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 200000];
    let best = targets[0];
    for (const t of targets) if (t / mPerPx < 120) best = t;
    const w = best / mPerPx;
    const sb = $('#scalebar');
    sb.querySelector('span').textContent = best >= 1000 ? (best / 1000) + ' km' : best + ' m';
    sb.querySelector('i').style.width = w.toFixed(0) + 'px';
  },
  drawLabels() {
    const detail = this.s > 4200;
    const src = detail ? this.sgg : this.sido;
    const out = [];
    for (const f of src) {
      if (!f.ct) continue;
      const [x, y] = this.toScreen(f.ct[1], f.ct[0]);
      if (x < -40 || y < -20 || x > this.W + 40 || y > this.H + 20) continue;
      out.push(`<text class="geolabel" x="${x.toFixed(1)}" y="${y.toFixed(1)}" style="font-size:${detail ? 10 : 11}px">${esc(f.n)}</text>`);
    }
    $('#gLbl').innerHTML = out.join('');
  },
  markerShape(kind, x, y, active) {
    const c = FAC_KINDS[kind].color, sh = FAC_KINDS[kind].shape;
    const r = active ? 7 : 5;
    if (sh === 'sq') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="1.5" fill="${c}" stroke="var(--surface)" stroke-width="1.5"/>`;
    if (sh === 'ci') return `<circle cx="${x}" cy="${y}" r="${r - .5}" fill="${c}" stroke="var(--surface)" stroke-width="1.5"/>`;
    if (sh === 'ci-o') return `<circle cx="${x}" cy="${y}" r="${r - 1}" fill="var(--surface)" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.4 1.8"/>`;
    if (sh === 'tri') return `<path d="M${x} ${y - r} L${x + r} ${y + r * .8} L${x - r} ${y + r * .8}Z" fill="${c}" stroke="var(--surface)" stroke-width="1.3"/>`;
    if (sh === 'dia') return `<path d="M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y}Z" fill="${c}" stroke="var(--surface)" stroke-width="1.3"/>`;
    return '';
  },
  drawMarkers() {
    const out = [];
    // 노선(선) 레이어: 두 지점 이상을 잇는 참조선
    for (const kind of ['rail', 'oldrail']) {
      if (!this.layers[kind]) continue;
      const lines = S.facilities.filter(f => f.kind === kind && Array.isArray(f.path) && f.path.length > 1);
      for (const f of lines) {
        const d = f.path.map(p => { const s = this.toScreen(p[0], p[1]); return s[0].toFixed(1) + ' ' + s[1].toFixed(1); }).join('L');
        out.push(`<g class="mk" data-fac="${f.id}" data-tip="${esc(facTip(f))}"><path d="M${d}" fill="none" stroke="${FAC_KINDS[kind].color}" stroke-width="${kind === 'rail' ? 2 : 1.6}" ${kind === 'oldrail' ? 'stroke-dasharray="6 4"' : ''} opacity=".8"/>
          <path class="mk-hit" d="M${d}" fill="none" stroke-width="12"/></g>`);
        // 노선 이름은 충분히 확대했을 때만
        if (this.s > 12000 && f.name) {
          const mid = f.path[Math.floor(f.path.length / 2)];
          const [mx, my] = this.toScreen(mid[0], mid[1]);
          out.push(`<text x="${mx.toFixed(1)}" y="${(my - 6).toFixed(1)}" class="geolabel" style="fill:${FAC_KINDS[kind].color};font-size:10px">${esc(f.name)}</text>`);
        }
      }
    }
    // 그리는 중인 노선
    if (this.drawing && this.draft.length) {
      const c = FAC_KINDS[this.drawing.kind].color;
      const pts = this.draft.map(p => this.toScreen(p[0], p[1]));
      if (pts.length > 1) out.push(`<path d="M${pts.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L')}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="5 4"/>`);
      for (const q of pts) out.push(`<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3.5" fill="var(--surface)" stroke="${c}" stroke-width="1.8"/>`);
    }
    // 반경
    if (this.radius && this.layers.apt) {
      const [clat] = this.toLatLng(this.W / 2, this.H / 2);
      const pxPerM = (this.s * KX) / (111320 * Math.cos(clat * Math.PI / 180));
      const rp = this.radius * pxPerM;
      if (rp > 3 && rp < 4000) {
        for (const p of S.projects) {
          if (p.lat == null || p.lng == null) continue;
          const [x, y] = this.toScreen(p.lat, p.lng);
          out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rp.toFixed(1)}" fill="color-mix(in srgb,var(--signal) 9%,transparent)" stroke="var(--signal)" stroke-width="1" stroke-dasharray="3 3" opacity=".65"/>`);
        }
      }
    }
    // 참조 지점
    for (const f of S.facilities) {
      if (!this.layers[f.kind] || f.kind === 'rail' || f.kind === 'oldrail') continue;
      if (f.lat == null || f.lng == null) continue;
      const [x, y] = this.toScreen(f.lat, f.lng);
      if (x < -20 || y < -20 || x > this.W + 20 || y > this.H + 20) continue;
      out.push(`<g class="mk" data-fac="${f.id}" data-tip="${esc(facTip(f))}">${this.markerShape(f.kind, x.toFixed(1), y.toFixed(1))}<circle class="mk-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/></g>`);
    }
    // 프로젝트
    if (this.layers.apt) {
      const showName = this.s > 9000;
      for (const p of S.projects) {
        if (p.lat == null || p.lng == null) continue;
        const [x, y] = this.toScreen(p.lat, p.lng);
        if (x < -30 || y < -30 || x > this.W + 30 || y > this.H + 30) continue;
        const act = S.sel.has(p.id) || S.cur === p.id;
        out.push(`<g class="mk" data-prj="${p.id}" data-tip="${esc(prjTip(p))}">${act ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="color-mix(in srgb,var(--signal) 18%,transparent)"/>` : ''}${this.markerShape('apt', x.toFixed(1), y.toFixed(1), act)}${showName ? `<text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" class="geolabel" style="fill:var(--ink);font-size:11px;font-weight:600">${esc(projName(p))}</text>` : ''}<circle class="mk-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/></g>`);
      }
    }
    $('#gMk').innerHTML = out.join('');
  },
  draw() { this.buildLayerUI(); this.apply(); },
  /** 참조 지점 정보창. 프로젝트는 마커를 누르면 곧장 상세 화면으로 간다. */
  showInfo(o) {
    if (!o) return;
    const box = $('#mapinfo');
    box.hidden = false;
    const isLine = Array.isArray(o.path) && o.path.length > 1;
    box.innerHTML = `<div class="body"><h3>${esc(o.name || FAC_KINDS[o.kind].label)}</h3>
      <div class="hint">${FAC_KINDS[o.kind].label}${o.year ? ' · ' + esc(o.year) : ''}${isLine ? ` · ${o.path.length}점 · ${fmtKm(this.pathLength(o.path))}` : ''}</div>
      ${o.note ? `<p style="font-size:12px;color:var(--ink2);margin:8px 0 0">${esc(o.note)}</p>` : ''}
      ${o.src ? `<p class="hint" style="margin:6px 0 0">가져온 데이터 · ${esc(o.src.file || '')}</p>` : ''}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn sm" id="miEdit">${isLine ? '정보 편집' : '편집'}</button>
        ${isLine ? '<button class="btn sm" id="miRedraw">경로 다시 그리기</button>' : ''}
        <button class="btn sm dgr" id="miDel">삭제</button>
        <button class="btn sm" id="miClose">닫기</button></div></div>`;
    $('#miEdit').onclick = () => isLine ? lineForm(o) : facilityForm(o);
    const rd = $('#miRedraw');
    if (rd) rd.onclick = () => { box.hidden = true; this.startLine(o.kind, o); };
    $('#miDel').onclick = async () => {
      if (!await confirmBox('참조 지점 삭제', `<p>${esc(o.name || FAC_KINDS[o.kind].label)} 을(를) 삭제할까요?</p>`)) return;
      await S.store.del('facilities', o.id);
      S.facilities = S.facilities.filter(f => f.id !== o.id);
      box.hidden = true; this.draw(); updateCounts();
    };
    $('#miClose').onclick = () => box.hidden = true;
  },
  setPick(on, cb) {
    this.picking = on; this.pickCb = cb || null;
    $('#pickbanner').classList.toggle('on', on);
    this.svg.style.cursor = on ? 'crosshair' : '';
  },
  locate(lat, lng, zoom) {
    this.s = zoom || 40000;
    const [x, y] = [w2x(lng) * this.s, w2y(lat) * this.s];
    this.tx = this.W / 2 - x; this.ty = this.H / 2 - y;
    this.apply();
  },
  fitTo(items) {
    const pts = items.filter(p => p.lat != null && p.lng != null);
    if (!pts.length) return;
    if (pts.length === 1) return this.locate(pts[0].lat, pts[0].lng, 30000);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of pts) { const x = w2x(p.lng), y = w2y(p.lat); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 60;
    this.s = Math.max(300, Math.min(200000, Math.min((this.W - pad * 2) / Math.max(1e-5, x1 - x0), (this.H - pad * 2) / Math.max(1e-5, y1 - y0))));
    this.tx = this.W / 2 - ((x0 + x1) / 2) * this.s; this.ty = this.H / 2 - ((y0 + y1) / 2) * this.s;
    this.apply();
  },
  /* ---------- 커서를 올렸을 때 이름 보여주기 ----------
     마커가 작아서 클릭해 보기 전에는 무엇인지 알 수 없었다. 전국 축척에서
     이름을 다 그리면 겹쳐서 못 읽으므로, 커서를 따라다니는 쪽지로 보여준다. */
  /** 화면 좌표에 어떤 마커가 있는지. 눌린 지점 둘레도 조금 살펴 손가락 오차를 흡수한다. */
  hitAt(cx, cy) {
    const seen = [[0, 0], [0, -7], [0, 7], [-7, 0], [7, 0]];
    for (const [dx, dy] of seen) {
      const t = document.elementFromPoint(cx + dx, cy + dy);
      const g = t && t.closest && t.closest('.mk');
      if (g) return g;
    }
    return null;
  },
  bindTip() {
    const el = this.svg, tip = $('#maptip');
    const wrap = () => $('#mapwrap').getBoundingClientRect();
    let cur = null;
    const hide = () => { cur = null; tip.classList.remove('on'); };
    el.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || this.dragging) return hide();
      const g = e.target.closest && e.target.closest('.mk');
      const t = g && g.dataset.tip;
      if (!t) return hide();
      if (t !== cur) { cur = t; tip.innerHTML = t; tip.classList.add('on'); }
      const r = wrap();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX - r.left + 14, y = e.clientY - r.top - h - 12;
      if (x + w > r.width - 6) x = e.clientX - r.left - w - 14;   // 오른쪽 끝에서는 왼쪽에
      if (y < 6) y = e.clientY - r.top + 18;                       // 위쪽 끝에서는 아래에
      tip.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`;
    });
    el.addEventListener('pointerleave', hide);
    el.addEventListener('pointerdown', hide);
  },
  bind() {
    const el = this.svg; const ptrs = new Map(); let moved = 0, lastDist = 0, lastMid = null;
    this.bindTip();
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
      if (ptrs.size === 1) { el.classList.add('drag'); this.dragging = true; }
    });
    el.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const r = el.getBoundingClientRect();
      if (ptrs.size === 1) {
        const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
        moved += Math.abs(dx) + Math.abs(dy);
        this.tx += dx; this.ty += dy; this.apply();
      } else if (ptrs.size === 2) {
        const p = Array.from(ptrs.values());
        const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        const mid = [(p[0][0] + p[1][0]) / 2 - r.left, (p[0][1] + p[1][1]) / 2 - r.top];
        if (lastDist) {
          this.zoomAt(mid[0], mid[1], d / lastDist);
          if (lastMid) { this.tx += mid[0] - lastMid[0]; this.ty += mid[1] - lastMid[1]; this.apply(); }
        }
        lastDist = d; lastMid = mid; moved += 20;
      }
    });
    const up = e => {
      el.classList.remove('drag'); ptrs.delete(e.pointerId);
      if (!ptrs.size) this.dragging = false;
      if (ptrs.size < 2) { lastDist = 0; lastMid = null; }
      if (moved < 6 && ptrs.size === 0) {
        const r = el.getBoundingClientRect();
        const [lat, lng] = this.toLatLng(e.clientX - r.left, e.clientY - r.top);
        if (this.drawing) { this.draft.push([+lat.toFixed(6), +lng.toFixed(6)]); this.updateDraft(); }
        else if (this.picking) { const cb = this.pickCb; this.setPick(false); if (cb) cb(lat, lng); }
        else {
          const hit = this.hitAt(e.clientX, e.clientY);
          if (hit && hit.dataset.prj) { $('#mapinfo').hidden = true; openDetail(hit.dataset.prj); }
          else if (hit && hit.dataset.fac) this.showInfo(S.facilities.find(f => f.id === hit.dataset.fac));
          else $('#mapinfo').hidden = true;
        }
      }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
    $('#zin').onclick = () => this.zoomAt(this.W / 2, this.H / 2, 1.6);
    $('#zout').onclick = () => this.zoomAt(this.W / 2, this.H / 2, 1 / 1.6);
    $('#zfit').onclick = () => this.fit();
    $('#pickCancel').onclick = () => this.setPick(false);
    addEventListener('resize', () => { this.resize(); });
  },
  /* ---------- 철도 노선 그리기 ----------
     역(점)과 달리 노선은 여러 점을 잇는 폴리라인이다. 지도를 눌러 점을 찍고
     「완료」를 누르면 facilities 문서에 path[[lat,lng],…] 로 저장된다. */
  startLine(kind, existing) {
    this.drawing = { kind, edit: existing || null };
    this.draft = existing && Array.isArray(existing.path) ? existing.path.slice() : [];
    this.picking = false;
    $('#pickbanner').classList.remove('on');
    $('#linebanner').classList.add('on');
    $('#lbKind').textContent = FAC_KINDS[kind].label + (existing ? ' 편집' : ' 그리기');
    this.svg.style.cursor = 'crosshair';
    this.updateDraft();
  },
  updateDraft() {
    $('#lbCount').textContent = this.draft.length + '점';
    $('#lbUndo').disabled = !this.draft.length;
    $('#lbDone').disabled = this.draft.length < 2;
    this.apply();
  },
  cancelLine() {
    this.drawing = null; this.draft = [];
    $('#linebanner').classList.remove('on');
    this.svg.style.cursor = '';
    this.apply();
  },
  /** 노선 길이(m) */
  pathLength(path) {
    let t = 0;
    for (let i = 1; i < path.length; i++) t += haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) || 0;
    return t;
  },
  /** 위경도로 시·도 / 시·군·구 판별 */
  reverse(lat, lng) {
    for (const f of this.sgg) if (pointInRings(lng, lat, f.rings)) return { sido: SIDO_OF(f.c), sgg: f.n };
    return { sido: '', sgg: '' };
  },
  /** 상세 페이지용 소형 지도 */
  mini(canvasSvg, lat, lng, radiusM) {
    const W = canvasSvg.clientWidth || 320, H = 190;
    // 가로 약 2.6km가 보이도록 축척 계산
    const s = (W / 2600) * 111320 * Math.cos(lat * Math.PI / 180) / KX;
    const cx = w2x(lng), cy = w2y(lat);
    const tx = W / 2 - cx * s, ty = H / 2 - cy * s;
    const P = (la, ln) => [(w2x(ln) * s + tx), (w2y(la) * s + ty)];
    const span = 0.35;
    let out = '';
    for (const f of this.sgg) {
      if (!f.ct || Math.abs(f.ct[0] - lng) > span || Math.abs(f.ct[1] - lat) > span) continue;
      let d = '';
      for (const r of f.rings) {
        d += 'M' + r.map(p => { const q = P(p[1], p[0]); return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L') + 'Z';
      }
      out += `<path d="${d}" fill="var(--land)" stroke="var(--line2)" stroke-width="0.8"/>`;
    }
    const pxPerM = (s * KX) / (111320 * Math.cos(lat * Math.PI / 180));
    for (const rm of (radiusM || [500, 1000])) {
      out += `<circle cx="${W / 2}" cy="${H / 2}" r="${(rm * pxPerM).toFixed(1)}" fill="none" stroke="var(--signal)" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/>`;
    }
    for (const f of S.facilities) {
      if (f.lat == null || f.kind === 'rail' || f.kind === 'oldrail') continue;
      const [x, y] = P(f.lat, f.lng);
      if (x < 0 || y < 0 || x > W || y > H) continue;
      out += this.markerShape(f.kind, x.toFixed(1), y.toFixed(1));
      out += `<text x="${(x + 8).toFixed(1)}" y="${(y + 3).toFixed(1)}" class="geolabel" style="text-anchor:start;fill:var(--muted)">${esc(f.name || '')}</text>`;
    }
    out += this.markerShape('apt', W / 2, H / 2, true);
    canvasSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    canvasSvg.innerHTML = out;
  }
};

/** 마커 쪽지 문구 — 이름이 먼저, 종류·지역은 작게 */
function prjTip(p) {
  const sub = [p.sido, p.sgg].filter(Boolean).join(' ');
  const bits = [];
  if (p.marketName) bits.push(p.marketName);
  if (p.builtYear) bits.push(p.builtYear + '년');
  if (p.marketFloors != null || p.aptFloors != null) bits.push(`${p.marketFloors == null ? '?' : p.marketFloors}＋${p.aptFloors == null ? '?' : p.aptFloors}층`);
  return `<b>${esc(projName(p))}</b>` + (sub ? `<i>${esc(sub)}</i>` : '') + (bits.length ? `<i>${esc(bits.join(' · '))}</i>` : '');
}
function facTip(f) {
  const k = FAC_KINDS[f.kind];
  const bits = [k.label];
  if (f.year) bits.push(f.year);
  if (Array.isArray(f.path) && f.path.length > 1) bits.push(fmtKm(MAP.pathLength(f.path)));
  return `<b>${esc(f.name || k.label)}</b><i>${esc(bits.join(' · '))}</i>`;
}

/** 프로젝트 기준 종류별 최근접 참조 지점 */
function nearestFacilities(p) {
  const out = {};
  if (p.lat == null || p.lng == null) return out;
  for (const f of S.facilities) {
    let d = null;
    if (Array.isArray(f.path) && f.path.length > 1) d = pointToPathDist(p.lat, p.lng, f.path);
    else if (f.lat != null && f.lng != null) d = haversine(p.lat, p.lng, f.lat, f.lng);
    if (d == null) continue;
    if (!out[f.kind] || d < out[f.kind].d) out[f.kind] = { d, f };
  }
  return out;
}
/** 점에서 폴리라인까지의 최단거리(m). 국지 범위라 평면 근사로 충분하다. */
function pointToPathDist(lat, lng, path) {
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const px = lng * mLng, py = lat * mLat;
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][1] * mLng, ay = path[i - 1][0] * mLat;
    const bx = path[i][1] * mLng, by = path[i][0] * mLat;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (best == null || d < best) best = d;
  }
  return best;
}

/* ============================================================
   정적 지도 이미지 — 보고서 · 발표자료 · PPTX 용
   화면 지도는 CSS 변수로 색을 쓰지만, 내보내는 SVG는 홀로 서야 하므로
   색을 리터럴로 박아 넣는다(테마와 무관하게 인쇄용 밝은 배경).
   ============================================================ */
const MAPPAL = {
  sea: '#F4F6F8', land: '#DCE1E6', line: '#B4BDC6', sggline: '#C9D0D8',
  ink: '#14171A', muted: '#6A737D',
  apt: '#C2472C', station: '#14477D', oldstation: '#14477D', terminal: '#2E7157', market: '#6D4C86'
};
/**
 * 독립 실행 가능한 SVG 문자열을 만든다.
 * @param {object} o  items(강조할 프로젝트) · all(회색 배경 점) · W · H · labels · facilities · pad
 */
function staticMapSvg(o) {
  const W = o.W || 1200, H = o.H || 760, pad = o.pad == null ? 26 : o.pad;
  const items = (o.items || []).filter(p => p.lat != null && p.lng != null);
  const all = (o.all || []).filter(p => p.lat != null && p.lng != null);
  let x0, x1, y0, y1;
  if (o.whole || !items.length) {
    x0 = w2x(125.0); x1 = w2x(130.0); y0 = w2y(38.7); y1 = w2y(33.1);
  } else {
    x0 = 1e9; x1 = -1e9; y0 = 1e9; y1 = -1e9;
    for (const p of items) { const x = w2x(p.lng), y = w2y(p.lat); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const mx = Math.max(0.06, (x1 - x0) * 0.35), my = Math.max(0.06, (y1 - y0) * 0.35);
    x0 -= mx; x1 += mx; y0 -= my; y1 += my;
  }
  const s = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0));
  const tx = W / 2 - ((x0 + x1) / 2) * s, ty = H / 2 - ((y0 + y1) / 2) * s;
  const P = (lat, lng) => [w2x(lng) * s + tx, w2y(lat) * s + ty];
  const scalePath = rings => {
    let d = '';
    for (const r of rings) d += 'M' + r.map(q => { const t = P(q[1], q[0]); return t[0].toFixed(1) + ' ' + t[1].toFixed(1); }).join('L') + 'Z';
    return d;
  };
  const parts = [`<rect width="${W}" height="${H}" fill="${MAPPAL.sea}"/>`];
  // 시도 경계
  parts.push(`<g fill="${MAPPAL.land}" stroke="${MAPPAL.line}" stroke-width="0.9" stroke-linejoin="round">` +
    MAP.sido.map(f => `<path d="${scalePath(f.rawRings || decodeRingsCache(f))}"/>`).join('') + `</g>`);
  // 시군구 경계는 충분히 확대했을 때만
  if (s > 3600) {
    parts.push(`<g fill="none" stroke="${MAPPAL.sggline}" stroke-width="0.6">` +
      MAP.sgg.filter(f => f.ct && f.ct[0] > (x0 / KX) - 0.5 && f.ct[0] < (x1 / KX) + 0.5 && -f.ct[1] > y0 - 0.5 && -f.ct[1] < y1 + 0.5)
        .map(f => `<path d="${scalePath(f.rings)}"/>`).join('') + `</g>`);
  }
  // 지역 이름
  if (o.geoLabels !== false) {
    const src = s > 3600 ? MAP.sgg : MAP.sido;
    parts.push(src.map(f => {
      if (!f.ct) return '';
      const [x, y] = P(f.ct[1], f.ct[0]);
      if (x < 4 || y < 10 || x > W - 4 || y > H - 4) return '';
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="sans-serif" font-size="${s > 3600 ? 10 : 12}" fill="${MAPPAL.muted}" text-anchor="middle">${esc(f.n)}</text>`;
    }).join(''));
  }
  // 철도 노선
  for (const kind of ['rail', 'oldrail']) {
    for (const f of (o.facilities || []).filter(f => f.kind === kind && Array.isArray(f.path) && f.path.length > 1)) {
      const d = f.path.map(q => { const t = P(q[0], q[1]); return t[0].toFixed(1) + ' ' + t[1].toFixed(1); }).join('L');
      parts.push(`<path d="M${d}" fill="none" stroke="${MAPPAL.station}" stroke-width="${kind === 'rail' ? 2 : 1.6}" ${kind === 'oldrail' ? 'stroke-dasharray="7 5"' : ''} opacity="0.75"/>`);
    }
  }
  // 참조 지점
  for (const f of (o.facilities || [])) {
    if (f.lat == null || f.kind === 'rail' || f.kind === 'oldrail') continue;
    const [x, y] = P(f.lat, f.lng);
    if (x < 0 || y < 0 || x > W || y > H) continue;
    const c = MAPPAL[f.kind] || MAPPAL.muted;
    if (f.kind === 'terminal') parts.push(`<path d="M${x} ${y - 5} L${x + 5} ${y + 4} L${x - 5} ${y + 4}Z" fill="${c}"/>`);
    else if (f.kind === 'market') parts.push(`<path d="M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y}Z" fill="${c}"/>`);
    else if (f.kind === 'oldstation') parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${c}" stroke-width="1.6" stroke-dasharray="2.4 1.8"/>`);
    else parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`);
  }
  // 선택되지 않은 프로젝트는 연한 점으로 배경에
  const hi = new Set(items.map(p => p.id));
  for (const p of all) {
    if (hi.has(p.id)) continue;
    const [x, y] = P(p.lat, p.lng);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="${MAPPAL.apt}" opacity="0.3"/>`);
  }
  // 강조 프로젝트
  for (const p of items) {
    const [x, y] = P(p.lat, p.lng);
    parts.push(`<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" rx="1.5" fill="${MAPPAL.apt}" stroke="#fff" stroke-width="1.6"/>`);
    if (o.labels) parts.push(`<text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-family="sans-serif" font-size="12" fill="${MAPPAL.ink}">${esc(projName(p))}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}
/* MAP.sido 는 경로 문자열만 갖고 있어 좌표를 다시 쓸 수 없다 → 최초 1회만 링을 복원해 캐시한다. */
function decodeRingsCache(f) {
  if (f.rawRings) return f.rawRings;
  const src = window.KRGEO.sido.find(g => g.c === f.c);
  f.rawRings = src ? decodeRings(src) : [];
  return f.rawRings;
}
/** SVG → JPEG dataURL. 외부 참조가 없는 SVG라 캔버스가 오염되지 않는다. */
function svgToJpeg(svg, W, H, scale) {
  const k = scale || 2;
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W * k; c.height = H * k;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => rej(new Error('지도 이미지를 만들지 못했습니다'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
/** 보고서·발표자료에서 바로 쓰는 지도 이미지 */
async function mapImage(o) {
  const W = o.W || 1200, H = o.H || 760;
  return await svgToJpeg(staticMapSvg(Object.assign({ facilities: S.facilities }, o, { W, H })), W, H, o.scale || 1.6);
}
