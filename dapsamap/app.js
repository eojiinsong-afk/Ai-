// 답사맵 — 화면과 흐름.
// 편집하는 것은 세 목록: photos(사진에서 읽은 원본, 고치지 않음) · buildings(고른 건물) · shots(사진별 판단: 건물·요소·위치 보정·메모)

const DEFAULTS = { vworldKey: '', layer: 'LT_C_SPBD', elements: ['입구', '시장', '아파트'], radius: 60, gapMin: 40 };
const SITE_COLORS = ['#2547C8', '#D9480F', '#2B8A3E', '#AE3EC9', '#C2255C', '#1098AD', '#E8590C', '#5C7CFA'];

const S = {
  settings: { ...DEFAULTS },
  photos: new Map(), sites: new Map(), buildings: new Map(), shots: new Map(),
  siteId: null, buildingId: null, shotId: null, tab: '전체',
  picking: false, moving: false
};
const $ = id => document.getElementById(id);
const urls = new Map();   // photoId → objectURL (미리보기)

// ───────── 공통 ─────────
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = iso => iso ? iso.slice(5, 10).replace('-', '/') + ' ' + iso.slice(11, 16) : '';
const siteColor = site => SITE_COLORS[(site?.colorIndex ?? 0) % SITE_COLORS.length];
const posOf = (photo, shot) => shot?.position || photo?.gps || null;
const headingOf = (photo, shot) => shot?.heading ?? photo?.heading ?? null;

async function save(store, obj) {
  const m = { photos: S.photos, sites: S.sites, buildings: S.buildings, shots: S.shots }[store];
  m.set(obj.id, obj);
  await Store.put(store, obj.id, obj);
}

async function thumbUrl(photoId) {
  if (urls.has(photoId)) return urls.get(photoId);
  const blob = await Store.get('thumbs', photoId);
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  urls.set(photoId, u);
  return u;
}

// ───────── 지도 ─────────
let map, baseCtl, layers = {};

function initMap() {
  map = L.map('map', { zoomControl: true, preferCanvas: false }).setView([36.4, 127.8], 7);
  layers.photos = L.layerGroup().addTo(map);
  layers.buildings = L.layerGroup().addTo(map);
  layers.shots = L.layerGroup().addTo(map);
  setBase();
  map.on('click', e => { if (S.picking) pickBuilding([+e.latlng.lng.toFixed(7), +e.latlng.lat.toFixed(7)]); });
}

let baseLayers = [];
function setBase() {
  baseLayers.forEach(l => map.removeLayer(l));
  if (baseCtl) { map.removeControl(baseCtl); baseCtl = null; }
  const key = S.settings.vworldKey.trim();
  if (key) {
    const ls = VWorld.tileLayers(key);
    ls['일반'].addTo(map);
    baseLayers = Object.values(ls);
    baseCtl = L.control.layers(ls, null, { position: 'topright' }).addTo(map);
    $('baseInfo').textContent = '배경지도: 브이월드';
  } else {
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    baseLayers = [osm];
    $('baseInfo').textContent = '배경지도: OpenStreetMap · 설정에 브이월드 키를 넣으면 건물 윤곽을 자동으로 가져옵니다';
  }
}

function coneIcon(heading, color, active) {
  const size = active ? 46 : 34;
  const h = heading == null ? null : heading;
  const cone = h == null ? '' :
    `<path d="M0 0 L-9 -22 A24 24 0 0 1 9 -22 Z" fill="${color}" fill-opacity="${active ? .45 : .28}" transform="rotate(${h})"/>`;
  const html = `<svg width="${size}" height="${size}" viewBox="-24 -24 48 48">${cone}
    <circle r="${active ? 6.5 : 5}" fill="${color}" stroke="#fff" stroke-width="2"/></svg>`;
  return L.divIcon({ className: 'shot-icon', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function drawMap(fit) {
  layers.photos.clearLayers(); layers.buildings.clearLayers(); layers.shots.clearLayers();
  const bounds = [];
  const b = S.buildings.get(S.buildingId);

  // 답사지 사진 점 + 동선
  for (const site of S.sites.values()) {
    if (S.siteId && site.id !== S.siteId) continue;
    const color = siteColor(site);
    const list = [...S.photos.values()].filter(p => p.siteId === site.id).sort((a, c) => a.takenAt.localeCompare(c.takenAt));
    const pts = [];
    for (const p of list) {
      const shot = S.shots.get(p.id);
      if (b && shot?.buildingId === b.id) continue;   // 고른 건물의 사진은 아래에서 방향과 함께 그림
      const pos = posOf(p, shot);
      if (!pos) continue;
      pts.push([pos[1], pos[0]]);
      L.circleMarker([pos[1], pos[0]], { radius: 4, color: '#fff', weight: 1, fillColor: color, fillOpacity: .9 })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); onDotClick(p); })
        .bindTooltip(`${fmtTime(p.takenAt)} · ${esc(p.fileName)}`)
        .addTo(layers.photos);
    }
    if (pts.length > 1) L.polyline(pts, { color, weight: 1.5, opacity: .45, dashArray: '3 4', interactive: false }).addTo(layers.photos);
    bounds.push(...pts);
  }

  // 건물
  for (const bl of S.buildings.values()) {
    if (S.siteId && bl.siteId && bl.siteId !== S.siteId) continue;
    const on = bl.id === S.buildingId;
    const style = { color: on ? '#16191D' : '#2547C8', weight: on ? 2.5 : 1.5, fillColor: on ? '#2547C8' : '#2547C8', fillOpacity: on ? .18 : .08 };
    const shape = bl.footprint
      ? L.geoJSON(bl.footprint, { style })
      : L.circle([bl.point[1], bl.point[0]], { radius: 8, ...style });
    shape.on('click', ev => { L.DomEvent.stopPropagation(ev); selectBuilding(bl.id); })
      .bindTooltip(esc(bl.name), { permanent: true, direction: 'top', className: 'bld-label', offset: [0, -6] })
      .addTo(layers.buildings);
    if (on) bounds.push([bl.point[1], bl.point[0]]);
  }

  // 고른 건물의 사진: 위치 + 바라본 방향
  if (b) {
    for (const shot of shotsOf(b.id)) {
      const p = S.photos.get(shot.photoId);
      const pos = posOf(p, shot);
      if (!pos) continue;
      const active = shot.photoId === S.shotId;
      const m = L.marker([pos[1], pos[0]], {
        icon: coneIcon(headingOf(p, shot), active ? '#16191D' : '#2547C8', active),
        draggable: active && S.moving, zIndexOffset: active ? 1000 : 0, keyboard: false
      }).addTo(layers.shots);
      m.on('click', ev => { L.DomEvent.stopPropagation(ev); selectShot(shot.photoId); });
      m.on('dragend', async () => {
        const ll = m.getLatLng();
        shot.position = [+ll.lng.toFixed(7), +ll.lat.toFixed(7)];
        shot.moved = true;
        await save('shots', shot);
        renderGrid();
      });
      bounds.push([pos[1], pos[0]]);
    }
  }
  if (fit && bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 });
}

// ───────── 답사지 ─────────
function renderSites() {
  const list = [...S.sites.values()].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  $('photoTotal').textContent = `사진 ${S.photos.size}장`;
  $('emptyHint').hidden = list.length > 0;
  $('siteList').innerHTML = list.map(site => {
    const n = [...S.photos.values()].filter(p => p.siteId === site.id).length;
    const blds = [...S.buildings.values()].filter(b => b.siteId === site.id);
    return `<li><div class="site ${site.id === S.siteId ? 'on' : ''}" data-site="${site.id}" tabindex="0" role="button">
      <span class="dot" style="background:${siteColor(site)}"></span>
      <span class="name" title="두 번 눌러 이름 바꾸기">${esc(site.name)}</span>
      <span class="meta">${esc(fmtTime(site.start))}–${esc((site.end || '').slice(11, 16))} · ${n}장${site.center ? '' : ' · 위치 없음'}</span>
      ${blds.length ? `<span class="blds">${blds.map(b => `<button type="button" class="bld ${b.id === S.buildingId ? 'on' : ''}" data-bld="${b.id}">${esc(b.name)} · ${shotsOf(b.id).length}장</button>`).join('')}</span>` : ''}
    </div></li>`;
  }).join('');
}

$('siteList').addEventListener('click', e => {
  const bb = e.target.closest('[data-bld]');
  if (bb) { selectBuilding(bb.dataset.bld); return; }
  const el = e.target.closest('[data-site]');
  if (el) selectSite(el.dataset.site === S.siteId ? null : el.dataset.site);
});
$('siteList').addEventListener('keydown', e => {
  const el = e.target.closest('[data-site]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectSite(el.dataset.site); }
});
$('siteList').addEventListener('dblclick', e => {
  const nm = e.target.closest('.name');
  if (!nm) return;
  const site = S.sites.get(nm.closest('[data-site]').dataset.site);
  const input = document.createElement('input');
  input.value = site.name; input.className = 'title-input'; input.style.fontSize = '14px';
  nm.replaceWith(input); input.focus(); input.select();
  const done = async ok => { if (ok && input.value.trim()) { site.name = input.value.trim(); await save('sites', site); } renderSites(); };
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
  input.addEventListener('blur', () => done(true));
});

function selectSite(id) {
  S.siteId = id;
  if (id && S.buildingId && S.buildings.get(S.buildingId)?.siteId !== id) { S.buildingId = null; S.shotId = null; renderBoard(); }
  renderSites(); drawMap(true);
}

// 새로 들어온 사진을 답사지로 묶는다. 같은 날 300m 안의 기존 답사지가 있으면 거기에 합친다.
async function assignSites(newPhotos) {
  const groups = Photos.cluster(newPhotos, S.settings.gapMin);
  const touched = new Set();
  for (const g of groups) {
    const c = Photos.center(g);
    const date = g[0].takenAt.slice(0, 10);
    let site = [...S.sites.values()].find(s => s.date === date && s.center && c && Geo.dist(s.center, c) < 300);
    if (!site) {
      site = { id: uid(), name: `답사지 ${S.sites.size + 1}`, date, center: c, colorIndex: S.sites.size, createdAt: new Date().toISOString(), autoName: true };
      S.sites.set(site.id, site);
    }
    for (const p of g) { p.siteId = site.id; await save('photos', p); }
    touched.add(site.id);
  }
  for (const id of touched) {
    const site = S.sites.get(id);
    const list = [...S.photos.values()].filter(p => p.siteId === id).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    site.start = list[0]?.takenAt; site.end = list.at(-1)?.takenAt; site.center = Photos.center(list);
    if (site.autoName && site.center && S.settings.vworldKey) {
      const a = await VWorld.address(S.settings.vworldKey, site.center);
      if (a?.text) { site.name = a.text.replace(/^\S+\s/, ''); site.address = a.text; site.autoName = false; }
    }
    await save('sites', site);
  }
  return touched;
}

// ───────── 사진 넣기 ─────────
async function importFiles(files) {
  const imgs = files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if (!imgs.length) { toast('사진 파일이 없습니다'); return; }
  const bySig = new Map([...S.photos.values()].map(p => [p.sig, p]));
  // 백업에서 불러와 미리보기가 없는 사진은 미리보기만 다시 만든다
  let refilled = 0;
  for (const f of imgs) {
    const p = bySig.get(`${f.name}|${f.size}|${f.lastModified}`);
    if (p && !(await Store.get('thumbs', p.id))) {
      try { await Store.put('thumbs', p.id, (await Photos.makeThumb(f)).blob); refilled++; } catch (e) { console.warn(e); }
    }
  }
  const todo = imgs.filter(f => !bySig.has(`${f.name}|${f.size}|${f.lastModified}`));
  const skipped = imgs.length - todo.length - refilled;
  if (refilled) { renderBoard(); if (!todo.length) { toast(`미리보기 ${refilled}장을 다시 만들었습니다`); return; } }
  if (!todo.length) { toast(`이미 넣은 사진입니다 (${skipped}장)`); return; }

  const st = $('importStatus');
  st.hidden = false;
  const added = []; let done = 0, failed = 0, noGps = 0, heic = 0;
  const show = () => { st.innerHTML = `사진 읽는 중 ${done} / ${todo.length}${heic ? ` · HEIC 변환 ${heic}` : ''}<div class="bar"><i style="width:${(done / todo.length) * 100}%"></i></div>`; };
  show();

  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      try {
        if (Photos.isHeic(f)) heic++;
        const meta = await Photos.readMeta(f);
        const th = await Photos.makeThumb(f);
        const p = { id: uid(), fileName: f.name, sig: `${f.name}|${f.size}|${f.lastModified}`, size: f.size, ...meta,
          width: th.width, height: th.height, importedAt: new Date().toISOString(), siteId: null };
        await Store.put('thumbs', p.id, th.blob);
        await save('photos', p);
        if (!p.gps) noGps++;
        added.push(p);
      } catch (e) { console.warn('사진 처리 실패', f.name, e); failed++; }
      done++; show();
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const touched = await assignSites(added);
  st.hidden = true;
  if (touched.size === 1) S.siteId = [...touched][0];
  renderSites(); drawMap(true);
  const parts = [`${added.length}장 → 답사지 ${touched.size}곳`];
  if (noGps) parts.push(`위치 없음 ${noGps}장`);
  if (skipped) parts.push(`중복 ${skipped}장 건너뜀`);
  if (failed) parts.push(`읽기 실패 ${failed}장`);
  toast(parts.join(' · '), 4500);
}

$('fileInput').addEventListener('change', e => { importFiles([...e.target.files]); e.target.value = ''; });

// 폴더째 끌어다 놓기
async function filesFromItems(items) {
  const out = [];
  async function walk(entry) {
    if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e);
      } while (batch.length);
    }
  }
  const entries = [...items].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  for (const e of entries) await walk(e);
  return out;
}
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('drop').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; $('drop').hidden = true;
  const items = e.dataTransfer.items;
  const files = items?.length && items[0].webkitGetAsEntry ? await filesFromItems(items) : [...e.dataTransfer.files];
  importFiles(files);
});

// ───────── 건물 고르기 ─────────
function setPicking(on) {
  S.picking = on;
  $('pickBtn').setAttribute('aria-pressed', on);
  $('mapHint').hidden = !on;
  $('map').classList.toggle('picking', on);
}
$('pickBtn').addEventListener('click', () => setPicking(!S.picking));

async function pickBuilding(pt) {
  setPicking(false);
  // 클릭한 자리가 이미 고른 건물이면 그 건물을 연다
  const hit = [...S.buildings.values()].find(b => Geo.distToBuilding(pt, b) < 3);
  if (hit) { selectBuilding(hit.id); return; }

  const near = [...S.sites.values()].filter(s => s.center).sort((a, b) => Geo.dist(pt, a.center) - Geo.dist(pt, b.center))[0];
  const b = { id: uid(), name: '', siteId: S.siteId || (near && Geo.dist(pt, near.center) < 1500 ? near.id : null),
    point: pt, footprint: null, floors: null, address: null, source: 'manual', createdAt: new Date().toISOString() };

  const key = S.settings.vworldKey.trim();
  if (key) {
    toast('브이월드에서 건물을 찾는 중…');
    const r = await VWorld.buildingAt(key, S.settings.layer, pt);
    if (r?.geometry) {
      b.footprint = r.geometry; b.floors = r.floors; b.vworld = r.props; b.source = 'vworld';
      b.point = Geo.centroid(r.geometry, pt).map(v => +v.toFixed(7));
      if (r.name) b.name = r.name;
    } else {
      toast(`건물 윤곽을 못 찾아 점으로 만듭니다 (${r?.error || '응답 없음'})`, 4000);
    }
    const a = await VWorld.address(key, b.point);
    if (a?.text) b.address = a.text;
  }
  if (!b.name) b.name = b.address ? b.address.split(' ').slice(-2).join(' ') : `건물 ${S.buildings.size + 1}`;
  await save('buildings', b);
  const n = await gather(b);
  selectBuilding(b.id);
  toast(`${b.name} · 주변 ${S.settings.radius}m 안의 사진 ${n}장을 모았습니다`);
}

// 건물 주변 반경 안의 사진을 모은다. 다른 건물에 이미 들어간 사진, 사용자가 뺀 사진은 건드리지 않는다.
async function gather(b) {
  let n = 0;
  for (const p of S.photos.values()) {
    if (b.siteId && p.siteId !== b.siteId) continue;
    const shot = S.shots.get(p.id);
    if (shot?.buildingId) continue;
    if (shot?.removedFrom?.includes(b.id)) continue;
    const pos = posOf(p, shot);
    if (!pos || Geo.distToBuilding(pos, b) > S.settings.radius) continue;
    const s = shot || { id: p.id, photoId: p.id, element: null, note: '', position: null, heading: null, moved: false, removedFrom: [] };
    s.buildingId = b.id;
    await save('shots', s);
    n++;
  }
  return n;
}

const shotsOf = bid => [...S.shots.values()].filter(s => s.buildingId === bid)
  .sort((a, b) => (S.photos.get(a.photoId)?.takenAt || '').localeCompare(S.photos.get(b.photoId)?.takenAt || ''));

async function onDotClick(p) {
  const b = S.buildings.get(S.buildingId);
  if (!b) { toast(`${fmtTime(p.takenAt)} · ${p.fileName}`); return; }
  // 건물을 연 상태에서 다른 점을 누르면 그 사진을 이 건물에 넣는다
  const s = S.shots.get(p.id) || { id: p.id, photoId: p.id, element: null, note: '', position: null, heading: null, moved: false, removedFrom: [] };
  const from = s.buildingId && s.buildingId !== b.id ? S.buildings.get(s.buildingId)?.name : null;
  s.buildingId = b.id;
  s.removedFrom = (s.removedFrom || []).filter(x => x !== b.id);
  await save('shots', s);
  selectShot(p.id);
  toast(from ? `${from}에서 옮겨 넣었습니다` : '이 건물에 넣었습니다');
}

// ───────── 건물 보드 ─────────
function selectBuilding(id) {
  S.buildingId = id; S.shotId = null; S.moving = false; S.tab = '전체';
  const b = S.buildings.get(id);
  if (b?.siteId && S.siteId && S.siteId !== b.siteId) S.siteId = b.siteId;
  renderSites(); renderBoard(); drawMap(true);
}

function elementList() {
  const set = [...S.settings.elements];
  // 설정에서 지운 요소라도 사진에 남아 있으면 탭으로 보여 준다 (데이터는 지우지 않는다)
  for (const s of shotsOf(S.buildingId)) if (s.element && !set.includes(s.element)) set.push(s.element);
  return set;
}

function tabFilter(tab) {
  if (tab === '전체') return () => true;
  if (tab === '미분류') return s => !s.element;
  return s => s.element === tab;
}

function renderBoard() {
  const b = S.buildings.get(S.buildingId);
  $('boardEmpty').hidden = !!b; $('boardBody').hidden = !b;
  if (!b) return;
  $('bName').value = b.name;
  const all = shotsOf(b.id);
  const site = S.sites.get(b.siteId);
  $('bMeta').textContent = [b.address, b.floors ? `지상 ${b.floors}층` : null, b.source === 'vworld' ? '브이월드 건물' : '직접 찍은 위치', site?.name].filter(Boolean).join(' · ');
  const tabs = ['전체', '미분류', ...elementList()];
  if (!tabs.includes(S.tab)) S.tab = '전체';
  $('tabs').innerHTML = tabs.map(t => `<button type="button" role="tab" class="tab ${t === S.tab ? 'on' : ''}" data-tab="${esc(t)}">${esc(t)}<span class="n">${all.filter(tabFilter(t)).length}</span></button>`).join('');
  renderGrid();
  renderViewer();
}

async function renderGrid() {
  const b = S.buildings.get(S.buildingId);
  if (!b) return;
  const list = shotsOf(b.id).filter(tabFilter(S.tab));
  const grid = $('grid');
  if (!list.length) {
    grid.innerHTML = `<p class="muted" style="grid-column:1/-1">${S.tab === '전체' ? `반경 ${S.settings.radius}m 안에 사진이 없습니다. 지도에서 점을 눌러 직접 넣을 수 있어요.` : '이 분류에 사진이 없습니다.'}</p>`;
    return;
  }
  grid.innerHTML = list.map(s => `<button type="button" class="thumb ${s.photoId === S.shotId ? 'on' : ''}" data-shot="${s.photoId}" title="${esc(S.photos.get(s.photoId)?.fileName)}">
    <img alt="" data-photo="${s.photoId}">${s.element ? `<span class="tag">${esc(s.element)}</span>` : ''}${s.moved ? '<span class="moved" title="위치 보정함"></span>' : ''}</button>`).join('');
  for (const img of grid.querySelectorAll('img[data-photo]')) img.src = await thumbUrl(img.dataset.photo);
}

$('tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (!t) return;
  S.tab = t.dataset.tab; renderBoard();
});
$('grid').addEventListener('click', e => {
  const t = e.target.closest('[data-shot]');
  if (t) selectShot(t.dataset.shot);
});
$('bName').addEventListener('change', async e => {
  const b = S.buildings.get(S.buildingId);
  if (!b || !e.target.value.trim()) return;
  b.name = e.target.value.trim();
  await save('buildings', b);
  renderSites(); drawMap(false);
});
$('addNearBtn').addEventListener('click', async () => {
  const b = S.buildings.get(S.buildingId);
  const n = await gather(b);
  renderSites(); renderBoard(); drawMap(false);
  toast(n ? `${n}장을 더 모았습니다` : '더 모을 사진이 없습니다');
});
$('delBuildingBtn').addEventListener('click', async () => {
  const b = S.buildings.get(S.buildingId);
  const n = shotsOf(b.id).length;
  const btn = $('delBuildingBtn');
  if (btn.dataset.confirm !== b.id) {
    btn.dataset.confirm = b.id; btn.textContent = n ? `사진 ${n}장 분류가 풀립니다. 한 번 더 누르면 삭제` : '한 번 더 누르면 삭제';
    setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '건물 삭제'; }, 4000);
    return;
  }
  // 사진의 요소·메모·위치 보정은 그대로 남기고 건물 연결만 푼다
  for (const s of shotsOf(b.id)) { s.buildingId = null; await save('shots', s); }
  S.buildings.delete(b.id); await Store.del('buildings', b.id);
  btn.dataset.confirm = ''; btn.textContent = '건물 삭제';
  S.buildingId = null; S.shotId = null;
  renderSites(); renderBoard(); drawMap(false);
  toast('건물을 삭제했습니다. 사진의 메모와 요소는 남아 있습니다');
});

// ───────── 사진 보기 · 요소 · 위치 보정 ─────────
function selectShot(photoId) {
  S.shotId = photoId; S.moving = false;
  const s = S.shots.get(photoId);
  if (s && S.tab !== '전체' && !tabFilter(S.tab)(s)) S.tab = '전체';
  renderBoard(); drawMap(false);
  document.querySelector(`.thumb[data-shot="${photoId}"]`)?.scrollIntoView({ block: 'nearest' });
}

async function renderViewer() {
  const s = S.shots.get(S.shotId);
  const v = $('viewer');
  if (!s || s.buildingId !== S.buildingId) { v.hidden = true; return; }
  v.hidden = false;
  const p = S.photos.get(s.photoId);
  $('vImg').src = await thumbUrl(p.id);
  $('vImg').alt = p.fileName;
  const h = headingOf(p, s);
  $('vMeta').textContent = [fmtTime(p.takenAt), p.fileName, p.gps ? null : '사진에 위치 없음', p.camera].filter(Boolean).join(' · ');
  $('vChips').innerHTML = elementList().map((el, i) =>
    `<button type="button" class="chip ${s.element === el ? 'on' : ''}" data-el="${esc(el)}">${i < 9 ? `<span class="k">${i + 1}</span>` : ''}${esc(el)}</button>`).join('');
  if (document.activeElement !== $('vNote')) $('vNote').value = s.note || '';
  $('vHeading').value = h ?? 0;
  $('vHeadingOut').textContent = h == null ? '없음' : h + '°';
  $('moveBtn').setAttribute('aria-pressed', S.moving);
  $('resetPosBtn').disabled = !s.moved && s.heading == null;
}

async function setElement(el) {
  const s = S.shots.get(S.shotId);
  if (!s) return;
  s.element = s.element === el ? null : el;
  await save('shots', s);
  renderBoard();
}
$('vChips').addEventListener('click', e => { const c = e.target.closest('[data-el]'); if (c) setElement(c.dataset.el); });

let noteTimer;
$('vNote').addEventListener('input', e => {
  const s = S.shots.get(S.shotId);
  if (!s) return;
  s.note = e.target.value;
  clearTimeout(noteTimer); noteTimer = setTimeout(() => save('shots', s), 400);
});
$('vHeading').addEventListener('input', async e => {
  const s = S.shots.get(S.shotId);
  if (!s) return;
  s.heading = +e.target.value;
  $('vHeadingOut').textContent = s.heading + '°';
  drawMap(false);
  clearTimeout(noteTimer); noteTimer = setTimeout(() => save('shots', s), 300);
});
$('moveBtn').addEventListener('click', () => {
  const s = S.shots.get(S.shotId);
  const p = S.photos.get(S.shotId);
  if (!s) return;
  if (!posOf(p, s)) {
    // 위치 없는 사진: 건물 중심에 놓고 끌어서 맞추게 한다
    const b = S.buildings.get(S.buildingId);
    s.position = [...b.point]; s.moved = true; save('shots', s);
  }
  S.moving = !S.moving;
  renderViewer(); drawMap(false);
  if (S.moving) toast('지도에서 검은 점을 끌어 찍은 위치로 옮기세요');
});
$('resetPosBtn').addEventListener('click', async () => {
  const s = S.shots.get(S.shotId);
  s.position = null; s.heading = null; s.moved = false;
  await save('shots', s);
  S.moving = false;
  renderBoard(); drawMap(false);
});
$('removeShotBtn').addEventListener('click', async () => {
  const s = S.shots.get(S.shotId);
  const list = shotsOf(S.buildingId).filter(tabFilter(S.tab));
  const i = list.findIndex(x => x.photoId === s.photoId);
  s.removedFrom = [...new Set([...(s.removedFrom || []), s.buildingId])];
  s.buildingId = null;
  await save('shots', s);
  S.shotId = list[i + 1]?.photoId || list[i - 1]?.photoId || null;
  renderSites(); renderBoard(); drawMap(false);
});

// 키보드: ← → 이동, 숫자 요소, 0 지우기, Esc 취소
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, dialog')) return;
  if (e.key === 'Escape') { setPicking(false); if (S.moving) { S.moving = false; renderViewer(); drawMap(false); } return; }
  if (!S.buildingId) return;
  const list = shotsOf(S.buildingId).filter(tabFilter(S.tab));
  const i = list.findIndex(x => x.photoId === S.shotId);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const j = e.key === 'ArrowRight' ? Math.min(list.length - 1, i + 1) : Math.max(0, i - 1);
    if (list[j]) selectShot(list[j].photoId);
  } else if (/^[1-9]$/.test(e.key) && S.shotId) {
    const el = elementList()[+e.key - 1];
    if (el) setElement(el);
  } else if (e.key === '0' && S.shotId) {
    const s = S.shots.get(S.shotId);
    if (s?.element) { s.element = null; save('shots', s).then(renderBoard); }
  }
});

// ───────── 설정 ─────────
$('settingsBtn').addEventListener('click', () => {
  const st = S.settings;
  $('sKey').value = st.vworldKey; $('sLayer').value = st.layer;
  $('sElements').value = st.elements.join(', '); $('sRadius').value = st.radius; $('sGap').value = st.gapMin;
  $('settings').showModal();
});
$('sSave').addEventListener('click', async () => {
  const st = S.settings;
  const keyChanged = st.vworldKey !== $('sKey').value.trim();
  st.vworldKey = $('sKey').value.trim();
  st.layer = $('sLayer').value.trim() || DEFAULTS.layer;
  const els = $('sElements').value.split(',').map(x => x.trim()).filter(Boolean);
  st.elements = els.length ? [...new Set(els)] : [...DEFAULTS.elements];
  st.radius = Math.max(10, Math.min(300, +$('sRadius').value || DEFAULTS.radius));
  st.gapMin = Math.max(5, Math.min(240, +$('sGap').value || DEFAULTS.gapMin));
  await Store.put('settings', 'main', st);
  if (keyChanged) setBase();
  renderBoard();
  toast('설정을 저장했습니다');
});

// ───────── 내보내기 ─────────
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

function exportGeoJSON() {
  const features = [];
  for (const b of S.buildings.values()) {
    const shots = shotsOf(b.id);
    const counts = {};
    for (const s of shots) counts[s.element || '미분류'] = (counts[s.element || '미분류'] || 0) + 1;
    features.push({ type: 'Feature', geometry: b.footprint || { type: 'Point', coordinates: b.point },
      properties: { kind: 'building', id: b.id, name: b.name, address: b.address, floors: b.floors, source: b.source,
        site: S.sites.get(b.siteId)?.name || null, photos: shots.length, elements: counts } });
  }
  for (const s of S.shots.values()) {
    if (!s.buildingId) continue;
    const p = S.photos.get(s.photoId);
    const pos = posOf(p, s);
    if (!pos) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: pos },
      properties: { kind: 'shot', photoId: p.id, file: p.fileName, takenAt: p.takenAt, building: S.buildings.get(s.buildingId)?.name,
        buildingId: s.buildingId, element: s.element, note: s.note || '', heading: headingOf(p, s), moved: !!s.moved, gpsOriginal: p.gps } });
  }
  download(`dapsamap-${stamp()}.geojson`, JSON.stringify({ type: 'FeatureCollection', features }, null, 1), 'application/geo+json');
}

function exportCSV() {
  const rows = [['답사지', '건물', '요소', '파일', '촬영시각', '위도', '경도', '방향(도)', '위치보정', '메모']];
  const photos = [...S.photos.values()].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  for (const p of photos) {
    const s = S.shots.get(p.id);
    const pos = posOf(p, s);
    rows.push([S.sites.get(p.siteId)?.name || '', S.buildings.get(s?.buildingId)?.name || '', s?.element || '', p.fileName,
      p.takenAt.replace('T', ' '), pos?.[1] ?? '', pos?.[0] ?? '', headingOf(p, s) ?? '', s?.moved ? 'O' : '', s?.note || '']);
  }
  const csv = rows.map(r => r.map(v => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\r\n');
  download(`dapsamap-${stamp()}.csv`, '﻿' + csv, 'text/csv');
}

function exportBackup() {
  const { vworldKey, ...settings } = S.settings;   // 인증키는 파일에 넣지 않는다
  const data = { app: 'dapsamap', format: 1, exportedAt: new Date().toISOString(), settings,
    sites: [...S.sites.values()], buildings: [...S.buildings.values()], photos: [...S.photos.values()], shots: [...S.shots.values()] };
  download(`dapsamap-backup-${stamp()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

$('exportBtn').addEventListener('click', () => $('exportDlg').showModal());
$('exportDlg').addEventListener('click', e => {
  const k = e.target.closest('[data-export]')?.dataset.export;
  if (k === 'geojson') exportGeoJSON();
  if (k === 'csv') exportCSV();
  if (k === 'backup') exportBackup();
});
// 백업 불러오기: 항상 병합, 같은 ID가 이미 있으면 기존 것을 유지한다
$('restoreInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'dapsamap') throw new Error('답사맵 백업 파일이 아닙니다');
    let n = 0;
    for (const store of ['sites', 'buildings', 'photos', 'shots']) {
      for (const o of d[store] || []) {
        if (!o?.id || { sites: S.sites, buildings: S.buildings, photos: S.photos, shots: S.shots }[store].has(o.id)) continue;
        await save(store, o); n++;
      }
    }
    renderSites(); drawMap(true);
    toast(`${n}개 항목을 불러왔습니다. 사진 미리보기는 사진을 다시 넣으면 생깁니다`, 4500);
  } catch (err) { toast('불러오기 실패: ' + err.message, 4500); }
});

// ───────── 시작 ─────────
(async function boot() {
  const st = await Store.get('settings', 'main');
  if (st) S.settings = { ...DEFAULTS, ...st };
  for (const [store, m] of [['photos', S.photos], ['sites', S.sites], ['buildings', S.buildings], ['shots', S.shots]]) {
    for (const [k, v] of await Store.all(store)) m.set(k, v);
  }
  initMap();
  renderSites(); renderBoard(); drawMap(true);
})().catch(e => { console.error(e); toast('시작하지 못했습니다: ' + e.message, 8000); });
