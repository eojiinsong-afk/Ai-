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
        out.push(`<path d="M${d}" fill="none" stroke="${FAC_KINDS[kind].color}" stroke-width="${kind === 'rail' ? 2 : 1.6}" ${kind === 'oldrail' ? 'stroke-dasharray="6 4"' : ''} opacity=".8"/>`);
      }
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
      out.push(`<g class="mk" data-fac="${f.id}">${this.markerShape(f.kind, x.toFixed(1), y.toFixed(1))}<circle class="mk-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/></g>`);
    }
    // 프로젝트
    if (this.layers.apt) {
      const showName = this.s > 9000;
      for (const p of S.projects) {
        if (p.lat == null || p.lng == null) continue;
        const [x, y] = this.toScreen(p.lat, p.lng);
        if (x < -30 || y < -30 || x > this.W + 30 || y > this.H + 30) continue;
        const act = S.sel.has(p.id) || S.cur === p.id;
        out.push(`<g class="mk" data-prj="${p.id}">${act ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="color-mix(in srgb,var(--signal) 18%,transparent)"/>` : ''}${this.markerShape('apt', x.toFixed(1), y.toFixed(1), act)}${showName ? `<text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" class="geolabel" style="fill:var(--ink);font-size:11px;font-weight:600">${esc(projName(p))}</text>` : ''}<circle class="mk-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/></g>`);
      }
    }
    $('#gMk').innerHTML = out.join('');
    $$('#gMk .mk').forEach(g => g.onclick = e => {
      e.stopPropagation();
      if (g.dataset.prj) this.showInfo(S.projects.find(p => p.id === g.dataset.prj), 'prj');
      else this.showInfo(S.facilities.find(f => f.id === g.dataset.fac), 'fac');
    });
  },
  draw() { this.buildLayerUI(); this.apply(); },
  showInfo(o, kind) {
    if (!o) return;
    const box = $('#mapinfo');
    box.hidden = false;
    if (kind === 'prj') {
      const near = nearestFacilities(o);
      box.innerHTML = `<div class="body">
        <h3>${esc(projName(o))}</h3>
        <div class="hint">${esc([o.sido, o.sgg].filter(Boolean).join(' '))}${o.marketName ? ' · ' + esc(o.marketName) : ''}</div>
        <dl class="kv">
          <dt>답사일</dt><dd class="num">${esc(o.surveyDate || '—')}</dd>
          <dt>층수</dt><dd class="num">${o.marketFloors || '?'}＋${o.aptFloors || '?'} 층</dd>
          <dt>건축</dt><dd class="num">${o.builtYear || '—'}</dd>
          <dt>현재역</dt><dd class="num">${fmtKm(near.station && near.station.d)}</dd>
          <dt>과거역</dt><dd class="num">${fmtKm(near.oldstation && near.oldstation.d)}</dd>
          <dt>터미널</dt><dd class="num">${fmtKm(near.terminal && near.terminal.d)}</dd>
        </dl>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn sm pri" id="miOpen">상세 열기</button>
          <button class="btn sm" id="miClose">닫기</button>
        </div></div>`;
      $('#miOpen').onclick = () => openDetail(o.id);
    } else {
      box.innerHTML = `<div class="body"><h3>${esc(o.name || FAC_KINDS[o.kind].label)}</h3>
        <div class="hint">${FAC_KINDS[o.kind].label}${o.year ? ' · ' + esc(o.year) : ''}</div>
        ${o.note ? `<p style="font-size:12px;color:var(--ink2);margin:8px 0 0">${esc(o.note)}</p>` : ''}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn sm" id="miEdit">편집</button>
          <button class="btn sm dgr" id="miDel">삭제</button>
          <button class="btn sm" id="miClose">닫기</button></div></div>`;
      $('#miEdit').onclick = () => facilityForm(o);
      $('#miDel').onclick = async () => {
        if (!await confirmBox('참조 지점 삭제', `<p>${esc(o.name)} 을(를) 삭제할까요?</p>`)) return;
        await S.store.del('facilities', o.id);
        S.facilities = S.facilities.filter(f => f.id !== o.id);
        box.hidden = true; this.draw(); updateCounts();
      };
    }
    const c = $('#miClose'); if (c) c.onclick = () => box.hidden = true;
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
  bind() {
    const el = this.svg; const ptrs = new Map(); let moved = 0, lastDist = 0, lastMid = null;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0;
      if (ptrs.size === 1) el.classList.add('drag');
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
      if (ptrs.size < 2) { lastDist = 0; lastMid = null; }
      if (moved < 6 && ptrs.size === 0) {
        const r = el.getBoundingClientRect();
        const [lat, lng] = this.toLatLng(e.clientX - r.left, e.clientY - r.top);
        if (this.picking) { const cb = this.pickCb; this.setPick(false); if (cb) cb(lat, lng); }
        else if (e.target === el) $('#mapinfo').hidden = true;
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

/** 프로젝트 기준 종류별 최근접 참조 지점 */
function nearestFacilities(p) {
  const out = {};
  if (p.lat == null || p.lng == null) return out;
  for (const f of S.facilities) {
    if (f.lat == null || f.lng == null) continue;
    const d = haversine(p.lat, p.lng, f.lat, f.lng);
    if (d == null) continue;
    if (!out[f.kind] || d < out[f.kind].d) out[f.kind] = { d, f };
  }
  return out;
}
