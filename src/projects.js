/* ============================================================
   프로젝트 · 테이블 · 상세 · 사진 · 기록
   ============================================================ */
function allFields() { return BASE_FIELDS.concat(S.fields.map(f => ({ k: 'c_' + f.id, label: f.label, type: f.type, options: f.options, custom: f.id }))); }
function fieldValue(p, f) {
  const v = f.custom ? (p.custom || {})[f.custom] : p[f.k];
  return v == null ? '' : v;
}
const TABLE_COLS = ['surveyDate', 'sido', 'sgg', 'marketName', 'aptName', 'address', 'builtYear', 'marketFloors', 'aptFloors', 'totalFloors', 'parking', 'relation', 'status', 'nearStation', 'nearTerminal'];

/* ---------- filters + table ---------- */
/* 근접 필터: 값은 미터 문자열(‘1000’ = 1km 이내) 또는 'none'(등록된 지점이 없거나 멀리 떨어짐) */
const NEAR_OPTS = [['500', '500m 이내'], ['1000', '1km 이내'], ['2000', '2km 이내'], ['none', '2km 밖 · 없음']];
function nearPass(v, d) {
  if (!v) return true;
  if (v === 'none') return d == null || d > 2000;
  return d != null && d <= +v;
}
function renderFilters() {
  const sidos = Array.from(new Set(S.projects.map(p => p.sido).filter(Boolean))).sort();
  const sggs = Array.from(new Set(S.projects.filter(p => !S.filter.sido || p.sido === S.filter.sido).map(p => p.sgg).filter(Boolean))).sort();
  const tags = Array.from(new Set(S.projects.flatMap(p => p.tags || []))).sort();
  const rel = BASE_FIELDS.find(f => f.k === 'relation').options;
  const st = BASE_FIELDS.find(f => f.k === 'status').options;
  const opt = (arr, cur) => ['<option value="">전체</option>'].concat(arr.map(o => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`)).join('');
  const pairs = (arr, cur) => ['<option value="">전체</option>'].concat(arr.map(o => `<option value="${esc(o[0])}" ${cur === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`)).join('');
  // 사용자가 만든 선택형 항목도 그대로 필터가 된다
  const cf = S.fields.filter(f => f.type === 'select' && (f.options || []).length);
  const ADV = ['y0', 'y1', 'd0', 'd1', 'mf', 'af', 'nstation', 'noldstation', 'nterminal', 'hasphoto'];
  const advN = Object.keys(S.filter).filter(k => S.filter[k] && (ADV.includes(k) || k.slice(0, 3) === 'cf_')).length;
  $('#filters').innerHTML = `
    <span class="f">시·도 <select data-fk="sido">${opt(sidos, S.filter.sido)}</select></span>
    <span class="f">시·군·구 <select data-fk="sgg">${opt(sggs, S.filter.sgg)}</select></span>
    <span class="f">결합유형 <select data-fk="relation">${opt(rel, S.filter.relation)}</select></span>
    <span class="f">상태 <select data-fk="status">${opt(st, S.filter.status)}</select></span>
    <span class="f">주차장 <select data-fk="parking"><option value="">전체</option><option ${S.filter.parking === 'y' ? 'selected' : ''} value="y">있음</option><option ${S.filter.parking === 'n' ? 'selected' : ''} value="n">없음</option></select></span>
    <span class="f">태그 <select data-fk="tag">${opt(tags, S.filter.tag)}</select></span>
    <button class="btn sm" id="fmoreb" aria-expanded="${S.filterMore ? 'true' : 'false'}">상세 필터${advN ? ' · ' + advN : ''}</button>
    <span class="fmore" ${S.filterMore ? '' : 'hidden'}>
    <span class="f">건축연도 <input type="number" data-fk="y0" placeholder="부터" value="${esc(S.filter.y0 || '')}" style="width:76px"> – <input type="number" data-fk="y1" placeholder="까지" value="${esc(S.filter.y1 || '')}" style="width:76px"></span>
    <span class="f">답사일 <input type="date" data-fk="d0" value="${esc(S.filter.d0 || '')}" style="width:134px"> – <input type="date" data-fk="d1" value="${esc(S.filter.d1 || '')}" style="width:134px"></span>
    <span class="f">시장층수 ≤ <input type="number" data-fk="mf" value="${esc(S.filter.mf || '')}" style="width:62px"></span>
    <span class="f">아파트층수 ≥ <input type="number" data-fk="af" value="${esc(S.filter.af || '')}" style="width:62px"></span>
    <span class="f">현재역 <select data-fk="nstation">${pairs(NEAR_OPTS, S.filter.nstation)}</select></span>
    <span class="f">과거역 <select data-fk="noldstation">${pairs(NEAR_OPTS, S.filter.noldstation)}</select></span>
    <span class="f">터미널 <select data-fk="nterminal">${pairs(NEAR_OPTS, S.filter.nterminal)}</select></span>
    <span class="f">사진 <select data-fk="hasphoto"><option value="">전체</option><option value="y" ${S.filter.hasphoto === 'y' ? 'selected' : ''}>있음</option><option value="n" ${S.filter.hasphoto === 'n' ? 'selected' : ''}>없음</option></select></span>
    ${cf.map(f => `<span class="f">${esc(f.label)} <select data-fk="cf_${f.id}">${opt(f.options, S.filter['cf_' + f.id])}</select></span>`).join('')}
    </span>
    <button class="btn sm" id="fclear">필터 해제</button>
    <span class="spacer"></span><span class="hint" id="fcount"></span>`;
  $$('#filters [data-fk]').forEach(el => el.onchange = () => {
    S.filter[el.dataset.fk] = el.value;
    if (el.dataset.fk === 'sido') S.filter.sgg = '';
    renderTable();
  });
  $('#fmoreb').onclick = () => { S.filterMore = !S.filterMore; renderTable(); };
  $('#fclear').onclick = () => { S.filter = {}; S.q = ''; $('#q').value = ''; renderTable(); };
}
function filtered() {
  const q = S.q.trim().toLowerCase();
  const f = S.filter;
  const needNear = f.nstation || f.noldstation || f.nterminal;
  return S.projects.filter(p => {
    if (f.sido && p.sido !== f.sido) return false;
    if (f.sgg && p.sgg !== f.sgg) return false;
    if (f.relation && p.relation !== f.relation) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.parking === 'y' && !p.parking) return false;
    if (f.parking === 'n' && p.parking) return false;
    if (f.tag && !(p.tags || []).includes(f.tag)) return false;
    if (f.y0 && !(p.builtYear >= +f.y0)) return false;
    if (f.y1 && !(p.builtYear <= +f.y1)) return false;
    if (f.d0 && !(p.surveyDate && p.surveyDate >= f.d0)) return false;
    if (f.d1 && !(p.surveyDate && p.surveyDate <= f.d1)) return false;
    if (f.mf && !(p.marketFloors != null && p.marketFloors <= +f.mf)) return false;
    if (f.af && !(p.aptFloors != null && p.aptFloors >= +f.af)) return false;
    if (f.hasphoto === 'y' && !(p.photoCount > 0)) return false;
    if (f.hasphoto === 'n' && p.photoCount > 0) return false;
    for (const k of Object.keys(f)) {
      if (!f[k] || k.slice(0, 3) !== 'cf_') continue;
      if ((p.custom || {})[k.slice(3)] !== f[k]) return false;
    }
    if (needNear) {
      const n = nearestFacilities(p);
      if (!nearPass(f.nstation, n.station && n.station.d)) return false;
      if (!nearPass(f.noldstation, n.oldstation && n.oldstation.d)) return false;
      if (!nearPass(f.nterminal, n.terminal && n.terminal.d)) return false;
    }
    if (q) {
      const hay = [projName(p), p.marketName, p.aptName, p.address, p.sido, p.sgg, (p.tags || []).join(' '), p.note].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const k = S.sort.k, dir = S.sort.dir === 'asc' ? 1 : -1;
    let va = k === 'name' ? projName(a) : (k.slice(0, 2) === 'c_' ? (a.custom || {})[k.slice(2)] : a[k]);
    let vb = k === 'name' ? projName(b) : (k.slice(0, 2) === 'c_' ? (b.custom || {})[k.slice(2)] : b[k]);
    if (va == null || va === '') return 1; if (vb == null || vb === '') return -1;
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ko')) * dir;
  });
}
function renderTable() {
  renderFilters();
  const rows = filtered();
  $('#fcount').textContent = `${rows.length} / ${S.projects.length} 건`;
  updateSelStat();
  if (!S.projects.length) {
    $('#tblwrap').innerHTML = `<div class="empty"><h3>아직 기록된 시장아파트가 없습니다</h3>
      <p>지도에서 위치를 지정해 첫 프로젝트를 만들면, 시·도와 시·군·구가 자동으로 채워지고 사진·답사 기록이 그 아래에 쌓입니다.</p>
      <button class="btn pri" onclick="newProject()">＋ 새 프로젝트</button></div>`;
    return;
  }
  const cols = TABLE_COLS.map(k => BASE_FIELDS.find(f => f.k === k)).concat(S.fields.map(f => ({ k: 'c_' + f.id, label: f.label, type: f.type, custom: f.id })));
  const th = c => `<th data-sk="${c.k}" class="${S.sort.k === c.k ? 'sorted' : ''}">${esc(c.label)}${S.sort.k === c.k ? (S.sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
  const cell = (p, c) => {
    let v = fieldValue(p, c);
    if (c.type === 'bool') v = v ? '있음' : (v === false ? '없음' : '');
    if (Array.isArray(v)) v = v.join(', ');
    const n = (c.type === 'number' || c.type === 'date') ? ' n' : '';
    return `<td class="${n.trim()}">${esc(v)}</td>`;
  };
  $('#tblwrap').innerHTML = `<table class="grid"><thead><tr>
      <th class="stickycol" style="width:34px"><input type="checkbox" id="selall"></th>
      <th data-sk="name" class="${S.sort.k === 'name' ? 'sorted' : ''}">프로젝트</th>
      ${cols.map(th).join('')}<th>사진</th><th>기록</th></tr></thead><tbody>
    ${rows.map(p => `<tr data-id="${p.id}" class="${S.sel.has(p.id) ? 'sel' : ''}">
      <td class="stickycol"><input type="checkbox" data-sel="${p.id}" ${S.sel.has(p.id) ? 'checked' : ''}></td>
      <td class="name" data-open="${p.id}">${esc(projName(p))}</td>
      ${cols.map(c => cell(p, c)).join('')}
      <td class="n">${p.photoCount || 0}</td><td class="n">${p.noteCount || 0}</td></tr>`).join('')}
    </tbody></table>`;
  $$('#tblwrap th[data-sk]').forEach(h => h.onclick = () => {
    const k = h.dataset.sk;
    S.sort = { k, dir: S.sort.k === k && S.sort.dir === 'desc' ? 'asc' : 'desc' };
    renderTable();
  });
  $$('#tblwrap [data-open]').forEach(t => t.onclick = () => openDetail(t.dataset.open));
  $$('#tblwrap [data-sel]').forEach(c => c.onchange = () => {
    c.checked ? S.sel.add(c.dataset.sel) : S.sel.delete(c.dataset.sel);
    c.closest('tr').classList.toggle('sel', c.checked);
    updateSelStat(); MAP.draw(); updateCounts();
  });
  $('#selall').onchange = e => {
    rows.forEach(p => e.target.checked ? S.sel.add(p.id) : S.sel.delete(p.id));
    renderTable(); MAP.draw(); updateCounts();
  };
}
function updateSelStat() {
  const n = S.sel.size;
  $('#selstat').textContent = n ? `${n}개 선택됨` : '';
  ['#btnCompare', '#btnOnMap', '#btnReport', '#btnSlides'].forEach(s => $(s).disabled = n === 0);
  $('#outSel').textContent = n ? `${n}개 프로젝트 선택됨` : '선택된 프로젝트 없음 — 전체가 대상입니다';
}
$('#q').addEventListener('input', e => { S.q = e.target.value; renderTable(); });

/* ---------- create / edit ---------- */
function newProject(lat, lng) {
  const rev = (lat != null) ? MAP.reverse(lat, lng) : { sido: '', sgg: '' };
  const p = {
    id: uid(), name: '', marketName: '', aptName: '', sido: rev.sido, sgg: rev.sgg, address: '',
    lat: lat != null ? +lat.toFixed(6) : null, lng: lng != null ? +lng.toFixed(6) : null,
    surveyDate: today(), remodel: '미확인', relation: '미분류', status: '미확인',
    parking: false, tags: [], custom: {}, photoCount: 0, noteCount: 0
  };
  const m = openModal(`<div class="mh"><h3>새 프로젝트</h3><button class="x">×</button></div>
    <div class="mb"><div class="formgrid">
      <label class="fld"><span>시장명</span><input type="text" id="np_market" placeholder="예) 중앙시장"></label>
      <label class="fld"><span>시장아파트명</span><input type="text" id="np_apt" placeholder="예) 중앙시장아파트"></label>
      <label class="fld"><span>시·도</span><input type="text" id="np_sido" value="${esc(p.sido)}"></label>
      <label class="fld"><span>시·군·구</span><input type="text" id="np_sgg" value="${esc(p.sgg)}"></label>
      <label class="fld"><span>답사일</span><input type="date" id="np_date" value="${p.surveyDate}"></label>
      <label class="fld"><span>위도</span><input type="number" step="0.000001" id="np_lat" value="${p.lat != null ? p.lat : ''}"></label>
      <label class="fld"><span>경도</span><input type="number" step="0.000001" id="np_lng" value="${p.lng != null ? p.lng : ''}"></label>
    </div>
    <p class="hint" style="margin-top:10px">${p.lat != null ? '지도에서 지정한 위치입니다. 좌표를 넣으면 시·도·시·군·구가 자동으로 채워집니다.' : '위치는 나중에 지도에서 지정하거나 좌표를 직접 입력할 수 있습니다.'}</p></div>
    <div class="mf"><button class="btn" id="np_map">지도에서 위치 지정</button><button class="btn pri" id="np_ok">만들기</button></div>`);
  const sync = () => {
    const la = num($('#np_lat').value), ln = num($('#np_lng').value);
    if (la != null && ln != null) { const r = MAP.reverse(la, ln); if (r.sgg) { $('#np_sido').value = r.sido; $('#np_sgg').value = r.sgg; } }
  };
  $('#np_lat').oninput = sync; $('#np_lng').oninput = sync;
  $('#np_map').onclick = () => { closeModal(); go('map'); MAP.setPick(true, (la, ln) => newProject(la, ln)); };
  $('#np_ok').onclick = async () => {
    p.marketName = $('#np_market').value.trim();
    p.aptName = $('#np_apt').value.trim();
    p.sido = $('#np_sido').value.trim(); p.sgg = $('#np_sgg').value.trim();
    p.surveyDate = $('#np_date').value;
    p.lat = num($('#np_lat').value); p.lng = num($('#np_lng').value);
    p.name = p.aptName || (p.marketName ? p.marketName + '아파트' : '새 프로젝트');
    await saveProject(p);
    closeModal(); renderTable(); openDetail(p.id);
    toast('프로젝트를 만들었습니다');
  };
}
$('#btnNewPrj').onclick = () => newProject();
$('#btnNewPrj2').onclick = () => newProject();
$('#btnPick').onclick = () => { go('map'); MAP.setPick(true, (la, ln) => newProject(la, ln)); };
$('#btnOnMap').onclick = () => { go('map'); MAP.fitTo(S.projects.filter(p => S.sel.has(p.id))); };

/* ---------- facility (참조 지점) ---------- */
function facilityForm(f, lat, lng) {
  const isNew = !f;
  f = f || { id: uid(), kind: 'station', name: '', lat: lat != null ? +lat.toFixed(6) : null, lng: lng != null ? +lng.toFixed(6) : null, year: '', note: '' };
  const m = openModal(`<div class="mh"><h3>${isNew ? '참조 지점 추가' : '참조 지점 편집'}</h3><button class="x">×</button></div>
    <div class="mb"><div class="formgrid">
      <label class="fld"><span>종류</span><select id="fc_kind">${Object.entries(FAC_KINDS).filter(([k]) => k !== 'apt' && k !== 'rail' && k !== 'oldrail').map(([k, v]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="fld"><span>이름</span><input type="text" id="fc_name" value="${esc(f.name)}" placeholder="예) 구 천안역"></label>
      <label class="fld"><span>연도·시기</span><input type="text" id="fc_year" value="${esc(f.year)}" placeholder="예) 1978"></label>
      <label class="fld"><span>위도</span><input type="number" step="0.000001" id="fc_lat" value="${f.lat != null ? f.lat : ''}"></label>
      <label class="fld"><span>경도</span><input type="number" step="0.000001" id="fc_lng" value="${f.lng != null ? f.lng : ''}"></label>
    </div>
    <label class="fld" style="margin-top:10px"><span>메모 (출처·근거)</span><textarea id="fc_note" rows="2">${esc(f.note)}</textarea></label></div>
    <div class="mf"><button class="btn" id="fc_pick">지도에서 위치 지정</button><button class="btn pri" id="fc_ok">저장</button></div>`);
  $('#fc_pick').onclick = () => {
    closeModal(); go('map');
    MAP.setPick(true, (la, ln) => facilityForm(Object.assign(f, {
      kind: $('#fc_kind') ? f.kind : f.kind, lat: +la.toFixed(6), lng: +ln.toFixed(6)
    })));
  };
  $('#fc_ok').onclick = async () => {
    f.kind = $('#fc_kind').value; f.name = $('#fc_name').value.trim(); f.year = $('#fc_year').value.trim();
    f.lat = num($('#fc_lat').value); f.lng = num($('#fc_lng').value); f.note = $('#fc_note').value.trim();
    if (f.lat == null || f.lng == null) return toast('좌표가 필요합니다');
    await S.store.put('facilities', f.id, f);
    const i = S.facilities.findIndex(x => x.id === f.id);
    if (i < 0) S.facilities.push(f); else S.facilities[i] = f;
    closeModal(); MAP.draw(); updateCounts(); toast('저장했습니다');
  };
}

/* ---------- 철도 노선 (폴리라인 참조 지점) ----------
   역·터미널과 저장 구조는 같고 path[[lat,lng],…] 를 추가로 갖는다.
   과거 노선은 kind='oldrail' 로 저장되어 지도 레이어에서 따로 켜고 끌 수 있다. */
function lineForm(f, path) {
  const isNew = !S.facilities.some(x => x.id === (f && f.id));
  f = f || { id: uid(), kind: 'rail', name: '', year: '', note: '', path: [] };
  if (path) f = Object.assign({}, f, { path });
  const len = MAP.pathLength(f.path || []);
  openModal(`<div class="mh"><h3>${isNew ? '철도 노선 저장' : '노선 정보 편집'}</h3><button class="x">×</button></div>
    <div class="mb"><div class="formgrid">
      <label class="fld"><span>구분</span><select id="ln_kind">
        <option value="rail" ${f.kind === 'rail' ? 'selected' : ''}>현재 철도 노선</option>
        <option value="oldrail" ${f.kind === 'oldrail' ? 'selected' : ''}>과거 철도 노선 (1970–80s)</option></select></label>
      <label class="fld"><span>노선명</span><input type="text" id="ln_name" value="${esc(f.name)}" placeholder="예) 장항선 (구선형)"></label>
      <label class="fld"><span>연도·시기</span><input type="text" id="ln_year" value="${esc(f.year)}" placeholder="예) 1978년 기준"></label>
      <label class="fld"><span>길이</span><input type="text" value="${fmtKm(len)} · ${(f.path || []).length}점" disabled></label>
    </div>
    <label class="fld" style="margin-top:10px"><span>메모 (출처·근거)</span><textarea id="ln_note" rows="3" placeholder="예) 1980년 철도청 노선도에서 옮겨 그림">${esc(f.note)}</textarea></label>
    <p class="hint" style="margin-top:8px">과거 노선은 <b>어느 자료에서 옮겨 그렸는지</b>를 메모에 남겨두면 논문 각주로 그대로 쓸 수 있습니다.</p></div>
    <div class="mf">${isNew ? '' : '<button class="btn dgr" id="ln_del">삭제</button>'}<span class="spacer"></span>
      <button class="btn pri" id="ln_ok">저장</button></div>`);
  $('#ln_ok').onclick = async () => {
    f.kind = $('#ln_kind').value; f.name = $('#ln_name').value.trim();
    f.year = $('#ln_year').value.trim(); f.note = $('#ln_note').value.trim();
    if (!Array.isArray(f.path) || f.path.length < 2) return toast('노선에는 점이 2개 이상 필요합니다');
    await S.store.put('facilities', f.id, f);
    const i = S.facilities.findIndex(x => x.id === f.id);
    if (i < 0) S.facilities.push(f); else S.facilities[i] = f;
    closeModal(); MAP.draw(); updateCounts(); toast('노선을 저장했습니다');
  };
  const del = $('#ln_del');
  if (del) del.onclick = async () => {
    if (!await confirmBox('노선 삭제', `<p>${esc(f.name || '이 노선')} 을(를) 삭제할까요?</p>`)) return;
    await S.store.del('facilities', f.id);
    S.facilities = S.facilities.filter(x => x.id !== f.id);
    closeModal(); $('#mapinfo').hidden = true; MAP.draw(); updateCounts();
  };
}
$('#drawRail').onclick = () => { go('map'); MAP.startLine('rail'); toast('지도를 눌러 노선을 따라 점을 찍으세요', 3400); };
$('#drawOldRail').onclick = () => { go('map'); MAP.startLine('oldrail'); toast('과거 노선을 따라 점을 찍으세요 — 출처를 메모에 남겨두면 좋습니다', 3800); };
$('#addFac').onclick = () => { go('map'); facilityForm(); };
$('#lbUndo').onclick = () => { MAP.draft.pop(); MAP.updateDraft(); };
$('#lbCancel').onclick = () => MAP.cancelLine();
$('#lbDone').onclick = () => {
  const d = MAP.drawing; if (!d) return;
  const path = MAP.draft.slice(), edit = d.edit;
  MAP.cancelLine();
  lineForm(edit || { id: uid(), kind: d.kind, name: '', year: '', note: '', path: [] }, path);
};

/* ---------- 이미지 처리 ---------- */
async function fileToImage(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch (e) { } }
  return await new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { res(img); }; img.onerror = rej; img.src = url;
  });
}
function drawScaled(img, maxW) {
  const w = img.width, h = img.height;
  const r = Math.min(1, maxW / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function sharpness(img) {
  const c = drawScaled(img, 180), ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const g = new Float32Array(c.width * c.height);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114);
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < c.height - 1; y++) for (let x = 1; x < c.width - 1; x++) {
    const i = y * c.width + x;
    const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - c.width] - g[i + c.width];
    sum += l; sq += l * l; n++;
  }
  return n ? Math.round((sq / n) - (sum / n) ** 2) : 0;
}
function toJpeg(canvas, maxBytes) {
  let q = 0.85, url = canvas.toDataURL('image/jpeg', q);
  while (url.length > maxBytes && q > 0.32) { q -= 0.12; url = canvas.toDataURL('image/jpeg', q); }
  return url;
}
async function ingestPhoto(file, pid, extra) {
  const img = await fileToImage(file);
  const full = drawScaled(img, 1500);
  let data = toJpeg(full, 235000);
  if (data.length > 235000) data = toJpeg(drawScaled(img, 1100), 235000);
  const thumb = toJpeg(drawScaled(img, 300), 40000);
  const id = uid();
  const meta = Object.assign({
    pid, cat: (extra && extra.cat) || '건물 전체', caption: '', date: today(), place: '', memo: '', tags: [],
    w: img.width, h: img.height, sharp: sharpness(img), size: data.length, kind: 'photo',
    createdAt: new Date().toISOString(), thumb
  }, extra || {});
  await S.store.put('photofull', id, { data });
  await S.store.put('photos', id, meta);
  if (img.close) img.close();
  return Object.assign({ id }, meta);
}

/* ---------- detail ---------- */
async function openDetail(id) {
  S.cur = id;
  const p = S.projects.find(x => x.id === id);
  if (!p) return;
  go('detail');
  $('#detTitle').textContent = projName(p);
  $('#detailgrid').innerHTML = '<div class="hint pad">불러오는 중…</div>';
  const [photos, notes] = await Promise.all([S.store.list('photos', ['pid', '==', id]), S.store.list('notes', ['pid', '==', id])]);
  S.photos = photos.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  S.notes = notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if ((p.photoCount || 0) !== S.photos.length || (p.noteCount || 0) !== S.notes.length) {
    p.photoCount = S.photos.length; p.noteCount = S.notes.length; saveProject(p);
  }
  renderDetail();
  MAP.draw();
}
function inputFor(p, f) {
  const v = fieldValue(p, f);
  const id = `f_${f.k}`;
  if (f.type === 'bool') return `<label class="fld"><span>${esc(f.label)}</span><select id="${id}" data-f="${f.k}"><option value="" ${v === '' ? 'selected' : ''}>미확인</option><option value="1" ${v === true ? 'selected' : ''}>있음</option><option value="0" ${v === false ? 'selected' : ''}>없음</option></select></label>`;
  if (f.type === 'select') return `<label class="fld"><span>${esc(f.label)}</span><select id="${id}" data-f="${f.k}">${(f.options || []).map(o => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  if (f.type === 'long') return `<label class="fld" style="grid-column:1/-1"><span>${esc(f.label)}</span><textarea id="${id}" data-f="${f.k}" rows="3">${esc(v)}</textarea></label>`;
  if (f.type === 'tags') return `<label class="fld" style="grid-column:1/-1"><span>${esc(f.label)} <span class="hint">쉼표로 구분</span></span><input type="text" id="${id}" data-f="${f.k}" value="${esc(Array.isArray(v) ? v.join(', ') : v)}"></label>`;
  if (f.type === 'multi') return `<label class="fld"><span>${esc(f.label)} <span class="hint">쉼표로 구분</span></span><input type="text" id="${id}" data-f="${f.k}" value="${esc(Array.isArray(v) ? v.join(', ') : v)}"></label>`;
  const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
  return `<label class="fld"><span>${esc(f.label)}</span><input type="${t}" ${t === 'number' ? 'step="any"' : ''} id="${id}" data-f="${f.k}" value="${esc(v)}"></label>`;
}
function renderDetail() {
  const p = S.projects.find(x => x.id === S.cur); if (!p) return;
  const near = nearestFacilities(p);
  const core = BASE_FIELDS.filter(f => !['tags', 'note'].includes(f.k));
  const custom = S.fields.map(f => ({ k: 'c_' + f.id, label: f.label, type: f.type, options: f.options, custom: f.id }));
  const distRow = (k, lbl) => `<div class="dist"><span>${lbl}</span><span class="hint">${near[k] ? esc(near[k].f.name || '') : '등록된 지점 없음'}</span><span class="d">${fmtKm(near[k] && near[k].d)}</span></div>`;
  $('#detailgrid').innerHTML = `
  <div>
    <div class="sec">
      <div class="sech"><h3>기본 정보</h3><div class="ln"></div><span class="hint">수정하면 자동 저장됩니다</span></div>
      <div class="formgrid" id="coreform">${core.map(f => inputFor(p, f)).join('')}</div>
      <div class="formgrid" style="margin-top:10px">${inputFor(p, BASE_FIELDS.find(f => f.k === 'tags'))}${inputFor(p, BASE_FIELDS.find(f => f.k === 'note'))}</div>
    </div>
    ${custom.length ? `<div class="sec"><div class="sech"><h3>사용자 정의 항목</h3><div class="ln"></div><button class="btn sm" onclick="go('set')">항목 관리</button></div>
      <div class="formgrid">${custom.map(f => inputFor(p, f)).join('')}</div></div>` : ''}
    <div class="sec">
      <div class="sech"><h3>사진 · ${S.photos.length}</h3><div class="ln"></div>
        <select id="upCat" style="width:auto;font-size:12px;padding:3px 6px">${PHOTO_CATS.map(c => `<option>${c}</option>`).join('')}</select>
        <label class="btn sm pri" style="margin:0">＋ 사진 추가<input type="file" id="upFile" accept="image/*" multiple hidden></label></div>
      ${S.photos.length ? `<div class="gallery" id="gal">${S.photos.map(ph => photoCard(ph)).join('')}</div>`
        : '<p class="hint">건물 전체·입면·시장 내부·계단·간판 등 범주를 나눠 올려두면 나중에 비교와 발표자료 구성이 쉬워집니다.</p><div class="gallery" id="gal" hidden></div>'}
    </div>
  </div>
  <div>
    <div class="sec">
      <div class="sech"><h3>위치</h3><div class="ln"></div><button class="btn sm" id="dtPick">지도에서 지정</button></div>
      <svg id="minimap"></svg>
      <p class="hint mono" style="margin:6px 0 0">${p.lat != null ? p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) : '좌표 없음'} · 반경 500m / 1km</p>
    </div>
    <div class="sec">
      <div class="sech"><h3>교통시설과의 거리</h3><div class="ln"></div><button class="btn sm" id="dtFac">＋ 참조 지점</button></div>
      ${distRow('station', '현재 기차역')}${distRow('oldstation', '과거 기차역')}${distRow('terminal', '버스터미널')}${distRow('market', '시장')}
      ${distRow('rail', '현재 철도 노선')}${distRow('oldrail', '과거 철도 노선')}
      <p class="hint" style="margin-top:8px">역·터미널·시장을 참조 지점으로 등록하면 모든 프로젝트에서 자동으로 거리를 계산합니다.</p>
    </div>
    <div class="sec">
      <div class="sech"><h3>답사 기록 · ${S.notes.length}</h3><div class="ln"></div><button class="btn sm pri" id="dtNote">＋ 기록</button></div>
      <div id="notelist">${S.notes.map(n => `<div class="notecard"><h4>${esc(n.title || '무제')}</h4>
        <div class="meta">${esc(n.date || '')} ${n.kind ? '· ' + esc(n.kind) : ''} <button class="btn sm" data-en="${n.id}" style="padding:1px 6px;margin-left:6px">편집</button><button class="btn sm dgr" data-dn="${n.id}" style="padding:1px 6px">삭제</button></div>
        <p>${esc(n.body || '')}</p></div>`).join('') || '<p class="hint">답사 기록·건축적 특징·도시조직·추후 조사할 내용을 자유롭게 남겨두세요.</p>'}</div>
    </div>
  </div>`;
  // 자동 저장
  $$('#detailgrid [data-f]').forEach(el => {
    el.onchange = async () => {
      const f = allFields().find(x => x.k === el.dataset.f); if (!f) return;
      let v = el.value;
      if (f.type === 'number') v = num(v);
      else if (f.type === 'bool') v = v === '' ? null : v === '1';
      else if (f.type === 'tags' || f.type === 'multi') v = v.split(',').map(s => s.trim()).filter(Boolean);
      if (f.custom) { p.custom = p.custom || {}; p.custom[f.custom] = v; } else p[f.k] = v;
      if (['name', 'aptName', 'marketName'].includes(f.k)) $('#detTitle').textContent = projName(p);
      if (f.k === 'lat' || f.k === 'lng') { const r = MAP.reverse(p.lat, p.lng); if (r.sgg) { p.sido = r.sido; p.sgg = r.sgg; } renderDetail(); }
      await saveProject(p);
    };
  });
  if (p.lat != null) MAP.mini($('#minimap'), p.lat, p.lng);
  $('#dtPick').onclick = () => { go('map'); MAP.setPick(true, async (la, ln) => { p.lat = +la.toFixed(6); p.lng = +ln.toFixed(6); const r = MAP.reverse(la, ln); if (r.sgg) { p.sido = r.sido; p.sgg = r.sgg; } await saveProject(p); openDetail(p.id); }); };
  $('#dtFac').onclick = () => facilityForm(null, p.lat, p.lng);
  $('#dtNote').onclick = () => noteForm(null);
  $$('#notelist [data-en]').forEach(b => b.onclick = () => noteForm(S.notes.find(n => n.id === b.dataset.en)));
  $$('#notelist [data-dn]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('기록 삭제', '<p>이 기록을 삭제할까요?</p>')) return;
    await S.store.del('notes', b.dataset.dn); S.notes = S.notes.filter(n => n.id !== b.dataset.dn);
    p.noteCount = S.notes.length; await saveProject(p); renderDetail();
  });
  const up = $('#upFile');
  up.onchange = async e => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    const cat = $('#upCat').value;
    toast(`사진 ${files.length}장 처리 중…`, 8000);
    for (const f of files) {
      try { const ph = await ingestPhoto(f, p.id, { cat }); S.photos.push(ph); }
      catch (err) { console.error(err); toast('사진 처리 실패: ' + f.name); }
    }
    p.photoCount = S.photos.length; await saveProject(p);
    renderDetail(); toast(`${files.length}장 추가했습니다`);
  };
  bindGallery();
}
function photoCard(ph) {
  return `<div class="ph" data-ph="${ph.id}"><img src="${ph.thumb}" alt="${esc(ph.caption || ph.cat)}" loading="lazy">
    <span class="badge">${esc(ph.kind === 'elevation' ? '입면' : ph.cat)}</span>
    ${ph.caption ? `<span class="cap">${esc(ph.caption)}</span>` : ''}</div>`;
}
function bindGallery() {
  $$('#gal [data-ph]').forEach(el => el.onclick = () => photoModal(el.dataset.ph));
}
async function photoModal(id) {
  const ph = S.photos.find(x => x.id === id); if (!ph) return;
  const full = await S.store.get('photofull', id);
  const m = openModal(`<div class="mh"><h3>사진 정보</h3><button class="x">×</button></div>
    <div class="mb"><div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:14px">
      <div><img src="${full ? full.data : ph.thumb}" style="width:100%;border-radius:4px;border:1px solid var(--line)" alt="">
        <p class="hint mono" style="margin:6px 0 0">${ph.w}×${ph.h}px · ${bytes(ph.size || 0)} · 선명도 ${ph.sharp || 0}</p></div>
      <div class="formgrid" style="grid-template-columns:1fr">
        <label class="fld"><span>카테고리</span><select id="ph_cat">${PHOTO_CATS.map(c => `<option ${ph.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="fld"><span>설명</span><input type="text" id="ph_cap" value="${esc(ph.caption)}"></label>
        <label class="fld"><span>촬영일</span><input type="date" id="ph_date" value="${esc(ph.date || '')}"></label>
        <label class="fld"><span>촬영 위치</span><input type="text" id="ph_place" value="${esc(ph.place || '')}" placeholder="예) 시장 남측 도로 건너편"></label>
        <label class="fld"><span>입면 방향</span><select id="ph_face"><option value="">미지정</option>${['동', '서', '남', '북', '북동', '북서', '남동', '남서'].map(d => `<option ${ph.face === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="fld"><span>태그</span><input type="text" id="ph_tags" value="${esc((ph.tags || []).join(', '))}"></label>
        <label class="fld"><span>연구 메모</span><textarea id="ph_memo" rows="3">${esc(ph.memo || '')}</textarea></label>
      </div></div></div>
    <div class="mf"><button class="btn dgr" id="ph_del">삭제</button><span class="spacer"></span>
      <button class="btn" id="ph_elev">입면 보정에 사용</button><button class="btn pri" id="ph_ok">저장</button></div>`, { wide: true });
  $('#ph_ok').onclick = async () => {
    Object.assign(ph, {
      cat: $('#ph_cat').value, caption: $('#ph_cap').value.trim(), date: $('#ph_date').value,
      place: $('#ph_place').value.trim(), face: $('#ph_face').value, memo: $('#ph_memo').value.trim(),
      tags: $('#ph_tags').value.split(',').map(s => s.trim()).filter(Boolean)
    });
    const d = Object.assign({}, ph); delete d.id;
    await S.store.put('photos', ph.id, d);
    closeModal(); renderDetail(); toast('저장했습니다');
  };
  $('#ph_del').onclick = async () => {
    if (!await confirmBox('사진 삭제', '<p>이 사진을 삭제할까요? 되돌릴 수 없습니다.</p>')) return;
    await S.store.del('photos', ph.id); await S.store.del('photofull', ph.id);
    S.photos = S.photos.filter(x => x.id !== ph.id);
    const p = S.projects.find(x => x.id === S.cur); if (p) { p.photoCount = S.photos.length; await saveProject(p); }
    closeModal(); renderDetail();
  };
  $('#ph_elev').onclick = () => { closeModal(); go('elev'); loadElevPhoto(ph.id); };
}
function noteForm(n) {
  const isNew = !n;
  n = n || { id: uid(), pid: S.cur, title: '', date: today(), kind: '답사 기록', body: '' };
  const kinds = ['답사 기록', '건축적 특징', '도시적 특징', '시장–주거 관계', '주변 도시조직', '개인적 관찰', '논문 메모', '추후 조사'];
  openModal(`<div class="mh"><h3>${isNew ? '새 기록' : '기록 편집'}</h3><button class="x">×</button></div>
    <div class="mb"><div class="formgrid">
      <label class="fld" style="grid-column:1/-1"><span>제목</span><input type="text" id="nt_t" value="${esc(n.title)}" placeholder="예) 시장 상부 주거동 진입 방식"></label>
      <label class="fld"><span>날짜</span><input type="date" id="nt_d" value="${esc(n.date)}"></label>
      <label class="fld"><span>분류</span><select id="nt_k">${kinds.map(k => `<option ${n.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    </div>
    <label class="fld" style="margin-top:10px"><span>내용</span><textarea id="nt_b" rows="10">${esc(n.body)}</textarea></label></div>
    <div class="mf"><button class="btn pri" id="nt_ok">저장</button></div>`);
  $('#nt_ok').onclick = async () => {
    Object.assign(n, { title: $('#nt_t').value.trim(), date: $('#nt_d').value, kind: $('#nt_k').value, body: $('#nt_b').value });
    if (!n.createdAt) n.createdAt = new Date().toISOString();
    const d = Object.assign({}, n); delete d.id;
    await S.store.put('notes', n.id, d);
    const i = S.notes.findIndex(x => x.id === n.id);
    if (i < 0) S.notes.unshift(n); else S.notes[i] = n;
    const p = S.projects.find(x => x.id === S.cur); if (p) { p.noteCount = S.notes.length; await saveProject(p); }
    closeModal(); renderDetail();
  };
}
$('#detBack').onclick = () => go('list');
$('#detDel').onclick = async () => {
  const p = S.projects.find(x => x.id === S.cur); if (!p) return;
  if (!await confirmBox('휴지통으로 이동', `<p><b>${esc(projName(p))}</b> 을(를) 휴지통으로 옮깁니다. 사진과 답사 기록은 지워지지 않고 그대로 남아, 복원하면 함께 돌아옵니다.</p>`, '휴지통으로 이동')) return;
  await deleteProject(p.id); go('list'); renderTable(); toast('휴지통으로 옮겼습니다 — 사진과 기록은 그대로 보관됩니다', 3600);
};
$('#detElev').onclick = () => { go('elev'); $('#elevPrj').value = S.cur; renderElevPicker(); };
