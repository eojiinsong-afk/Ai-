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

/* ---------- facility (참조 지점) ----------
   역·터미널·시장은 좌표가 곧 데이터다. 그래서 이 폼은 좌표를 넣는 방법을 세 가지로 둔다.
   (1) 위도·경도 직접 입력  (2) 지도에서 찍기  (3) 다른 지도 서비스에서 복사한 문자열 붙여넣기.
   어느 쪽이든 입력한 좌표가 어느 시·군·구에 떨어지는지 즉시 보여줘서 잘못 넣은 것을 바로 알아챈다. */
const KR_BOUNDS = { lat: [32.5, 39.5], lng: [123.5, 132.5] };
/** 붙여넣은 문자열에서 위경도를 뽑아낸다. 십진수·도분초·지도 URL 을 모두 받는다. */
function parseLatLng(str) {
  const t = String(str || '').trim();
  if (!t) return null;
  // 36°48'35.3"N 127°08'56.0"E  /  36 48 35.3 N, 127 8 56 E
  const dms = [];
  const re = /(\d{1,3})\s*[°d\s]\s*(\d{1,2})\s*['′\s]\s*([\d.]+)\s*["″]?\s*([NSEW북남동서])?/gi;
  let m;
  while ((m = re.exec(t)) && dms.length < 2) {
    let v = +m[1] + +m[2] / 60 + +m[3] / 3600;
    const h = (m[4] || '').toUpperCase();
    if (h === 'S' || h === 'W' || h === '남' || h === '서') v = -v;
    dms.push({ v, h });
  }
  if (dms.length === 2) return orient(dms[0], dms[1]);
  // 십진수 두 개. 지도 URL(@36.8,127.1 / lat=..&lng=.. / c=127.1,36.8) 도 결국 숫자 두 개다.
  const nums = (t.match(/-?\d{1,3}\.\d{3,}/g) || []).map(Number);
  if (nums.length < 2) {
    const loose = (t.match(/-?\d{1,3}(?:\.\d+)?/g) || []).map(Number)
      .filter(v => (v >= KR_BOUNDS.lat[0] && v <= KR_BOUNDS.lat[1]) || (v >= KR_BOUNDS.lng[0] && v <= KR_BOUNDS.lng[1]));
    if (loose.length < 2) return null;
    return orient({ v: loose[0] }, { v: loose[1] });
  }
  // 이름표(lat=/lng=)가 있으면 그대로 믿는다
  const la = t.match(/(?:lat|latitude|위도|y)\s*[=:]\s*(-?\d{1,3}\.\d+)/i);
  const ln = t.match(/(?:lng|lon|longitude|경도|x)\s*[=:]\s*(-?\d{1,3}\.\d+)/i);
  if (la && ln) return check(+la[1], +ln[1]);
  // 그 밖에는 값의 범위로 어느 쪽이 위도인지 정한다
  for (let i = 0; i + 1 < nums.length; i++) {
    const r = orient({ v: nums[i] }, { v: nums[i + 1] });
    if (r) return r;
  }
  return null;
  function orient(a, b) {
    const ha = (a.h || '').toUpperCase(), hb = (b.h || '').toUpperCase();
    const isLng = h => h && 'EW동서'.includes(h), isLat = h => h && 'NS북남'.includes(h);
    if (isLng(ha) || isLat(hb)) return check(b.v, a.v);   // 앞이 경도
    if (isLat(ha) || isLng(hb)) return check(a.v, b.v);   // 앞이 위도
    // 방위 표시가 없으면 값의 크기로 정한다 — 한반도에서 경도는 항상 위도보다 크다
    return Math.abs(a.v) > Math.abs(b.v) ? check(b.v, a.v) : check(a.v, b.v);
  }
  function check(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  }
}
function inKorea(lat, lng) {
  return lat != null && lng != null && lat >= KR_BOUNDS.lat[0] && lat <= KR_BOUNDS.lat[1] && lng >= KR_BOUNDS.lng[0] && lng <= KR_BOUNDS.lng[1];
}
function facilityForm(f, lat, lng) {
  const isNew = !S.facilities.some(x => x.id === (f && f.id));
  f = Object.assign({ id: uid(), kind: 'station', name: '', lat: null, lng: null, year: '', note: '' }, f || {});
  if (lat != null) { f.lat = +lat.toFixed(6); f.lng = +lng.toFixed(6); }
  openModal(`<div class="mh"><h3>${isNew ? '참조 지점 추가' : '참조 지점 편집'}</h3><button class="x">×</button></div>
    <div class="mb"><div class="formgrid">
      <label class="fld"><span>종류</span><select id="fc_kind">${Object.entries(FAC_KINDS).filter(([k]) => k !== 'apt' && k !== 'rail' && k !== 'oldrail').map(([k, v]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="fld"><span>이름</span><input type="text" id="fc_name" value="${esc(f.name)}" placeholder="예) 구 천안역"></label>
      <label class="fld"><span>연도·시기</span><input type="text" id="fc_year" value="${esc(f.year)}" placeholder="예) 1978"></label>
    </div>
    <div class="sech" style="margin:14px 0 8px"><h3>좌표</h3><div class="ln"></div><span class="hint">WGS84 십진도</span></div>
    <div class="formgrid">
      <label class="fld"><span>위도 (lat)</span><input type="number" step="0.000001" id="fc_lat" value="${f.lat != null ? f.lat : ''}" placeholder="36.809800"></label>
      <label class="fld"><span>경도 (lng)</span><input type="number" step="0.000001" id="fc_lng" value="${f.lng != null ? f.lng : ''}" placeholder="127.148900"></label>
      <label class="fld"><span>좌표 붙여넣기</span><input type="text" id="fc_paste" placeholder="36.8098, 127.1489 · 36°48'35&quot;N 127°08'56&quot;E · 지도 링크"></label>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:14px;margin-top:10px;align-items:start">
      <label class="fld"><span>메모 (출처·근거)</span><textarea id="fc_note" rows="4" placeholder="예) 국토지리정보원 1978년 지형도에서 판독">${esc(f.note)}</textarea></label>
      <div><svg id="fc_map" style="width:100%;height:150px;border:1px solid var(--line);border-radius:var(--r);background:var(--sea);display:block"></svg>
        <p class="hint" id="fc_where" style="margin:6px 0 0">좌표를 넣으면 어느 시·군·구인지 확인해 드립니다.</p></div>
    </div></div>
    <div class="mf"><button class="btn" id="fc_pick">지도에서 찍기</button><span class="spacer"></span>
      ${isNew ? '<button class="btn" id="fc_more">저장하고 계속 추가</button>' : ''}
      <button class="btn pri" id="fc_ok">저장</button></div>`, { wide: true });

  /** 화면의 입력값을 f 에 담는다. 지도로 나갔다 돌아와도 입력이 사라지지 않게 하는 핵심. */
  const collect = () => {
    f.kind = $('#fc_kind').value; f.name = $('#fc_name').value.trim(); f.year = $('#fc_year').value.trim();
    f.lat = num($('#fc_lat').value); f.lng = num($('#fc_lng').value); f.note = $('#fc_note').value.trim();
    return f;
  };
  const preview = () => {
    const la = num($('#fc_lat').value), ln = num($('#fc_lng').value);
    const w = $('#fc_where');
    if (la == null || ln == null) { w.textContent = '좌표를 넣으면 어느 시·군·구인지 확인해 드립니다.'; w.style.color = ''; $('#fc_map').innerHTML = ''; return; }
    if (!inKorea(la, ln)) {
      w.innerHTML = '⚠ 남한 범위를 벗어난 좌표입니다. 위도와 경도가 바뀌지 않았는지 확인하세요.';
      w.style.color = 'var(--signal)'; $('#fc_map').innerHTML = ''; return;
    }
    const r = MAP.reverse(la, ln);
    w.textContent = (r.sgg ? `${r.sido} ${r.sgg}` : '행정구역을 판별하지 못했습니다 (해안·경계 부근)');
    w.style.color = '';
    MAP.mini($('#fc_map'), la, ln, [500]);
  };
  ['#fc_lat', '#fc_lng'].forEach(id => $(id).oninput = preview);
  $('#fc_paste').oninput = e => {
    const r = parseLatLng(e.target.value);
    if (!r) return;
    $('#fc_lat').value = r.lat; $('#fc_lng').value = r.lng;
    preview();
  };
  preview();

  $('#fc_pick').onclick = () => {
    collect(); closeModal(); go('map');
    MAP.setPick(true, (la, ln) => facilityForm(f, la, ln));
  };
  const save = async keepOpen => {
    collect();
    if (f.lat == null || f.lng == null) return toast('좌표가 필요합니다');
    if (!inKorea(f.lat, f.lng) && !await confirmBox('범위 밖 좌표',
      `<p>위도 ${f.lat}, 경도 ${f.lng} 는 남한 범위를 벗어납니다. 그대로 저장할까요?</p>
       <p class="hint">위도와 경도를 바꿔 넣은 경우가 가장 흔합니다.</p>`, '그대로 저장')) return;
    await putRetry('facilities', f.id, f);
    const i = S.facilities.findIndex(x => x.id === f.id);
    if (i < 0) S.facilities.push(f); else S.facilities[i] = f;
    MAP.draw(); updateCounts();
    if (keepOpen) {
      toast(`${f.name || FAC_KINDS[f.kind].label} 저장 — 이어서 입력하세요`);
      facilityForm({ kind: f.kind, year: f.year, note: f.note });
    } else { closeModal(); toast('저장했습니다'); }
  };
  $('#fc_ok').onclick = () => save(false);
  const more = $('#fc_more'); if (more) more.onclick = () => save(true);
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
    await putRetry('facilities', f.id, f);
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
$('#impFac').onclick = () => importDialog();
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
/* 캔버스를 명시적으로 놓아준다.
   iOS 사파리는 캔버스에 쓸 수 있는 메모리 총량이 정해져 있어서, 수십 장을 잇달아
   처리하면 어느 순간부터 toDataURL 이 조용히 빈 문자열("data:,")을 돌려준다.
   폭·높이를 0으로 만들면 그 자리에서 메모리가 풀린다. */
function releaseCanvas(c) { try { c.width = 0; c.height = 0; } catch (e) { } }
const MIN_JPEG = 1200;                 // 이보다 짧으면 변환이 실패한 것으로 본다
const PHOTO_MAX = 220000;              // 문서 한도 256KB 안쪽 (dataURL 기준)
const THUMB_MAX = 42000;

function toJpeg(canvas, maxBytes) {
  let q = 0.85, url = canvas.toDataURL('image/jpeg', q);
  while (url.length > maxBytes && q > 0.3) { q -= 0.1; url = canvas.toDataURL('image/jpeg', q); }
  return url;
}
/** 한도 안에 들어올 때까지 크기를 줄여 가며 JPEG 을 만든다. 못 만들면 null. */
function encodeWithin(img, sizes, maxBytes) {
  let best = null;
  for (const maxW of sizes) {
    const c = drawScaled(img, maxW);
    let url = '';
    try { url = toJpeg(c, maxBytes); } catch (e) { /* 메모리 부족 */ }
    releaseCanvas(c);
    if (!url || url.length < MIN_JPEG) continue;      // 빈 결과 — 다음(더 작은) 크기로
    best = url;
    if (url.length <= maxBytes) return url;
  }
  return (best && best.length <= maxBytes) ? best : null;
}
function sharpness(img) {
  try {
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
    releaseCanvas(c);
    return n ? Math.round((sq / n) - (sum / n) ** 2) : 0;
  } catch (e) { return 0; }   // 선명도는 추천 정렬에만 쓰이므로 실패해도 사진은 살린다
}
/** 사진 한 장을 저장한다. 실패하면 왜 실패했는지 알 수 있는 오류를 던진다. */
async function ingestPhoto(file, pid, extra) {
  let img = null;
  try { img = await fileToImage(file); }
  catch (e) { throw new Error('이 브라우저가 열 수 없는 형식입니다 (HEIC 등)'); }
  if (!img || !img.width || !img.height) { if (img && img.close) img.close(); throw new Error('이미지 크기를 읽지 못했습니다'); }
  const W = img.width, H = img.height;
  try {
    const data = encodeWithin(img, [1500, 1200, 1000, 820, 640], PHOTO_MAX);
    if (!data) throw new Error('압축해도 저장 한도를 넘습니다 — 사진을 줄여서 올려주세요');
    const thumb = encodeWithin(img, [300, 220, 160], THUMB_MAX);
    if (!thumb) throw new Error('축소본을 만들지 못했습니다 (메모리 부족일 수 있습니다)');
    const sharp = sharpness(img);
    const id = uid();
    const meta = Object.assign({
      pid, cat: (extra && extra.cat) || '건물 전체', caption: '', date: today(), place: '', memo: '', tags: [],
      w: W, h: H, sharp, size: data.length, kind: 'photo',
      createdAt: new Date().toISOString(), thumb
    }, extra || {});
    await putRetry('photofull', id, { data });
    try {
      await putRetry('photos', id, meta);
    } catch (e) {
      // 메타를 못 썼으면 원본만 남아 떠돌게 되므로 되돌린다
      try { await S.store.del('photofull', id); } catch (e2) { }
      throw e;
    }
    return Object.assign({ id }, meta);
  } finally {
    if (img && img.close) img.close();
  }
}
/** 여러 장을 차례로 올린다. 한 장이 실패해도 나머지는 계속 올리고, 무엇이 왜 실패했는지 남긴다. */
async function uploadPhotos(files, p, cat) {
  const prog = progressStart(files.length, '사진 올리는 중');
  const ok = [], fail = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    prog.set(i, `${f.name} · ${bytes(f.size || 0)}`);
    try {
      const ph = await ingestPhoto(f, p.id, { cat });
      S.photos.push(ph); ok.push(ph);
    } catch (err) {
      console.error('사진 실패', f.name, err);
      fail.push({ name: f.name, file: f, msg: String((err && (err.message || err.code)) || err) });
    }
    // 한 장마다 화면에 숨 쉴 틈을 준다 — 안 그러면 진행 표시가 멈춘 것처럼 보인다
    await new Promise(r => setTimeout(r, 0));
  }
  prog.set(files.length, '');
  prog.done();
  p.photoCount = S.photos.length;
  try { await saveProject(p); } catch (e) { console.error(e); }
  renderDetail();
  if (!fail.length) { toast(`${ok.length}장 추가했습니다`); return; }
  photoFailReport(ok.length, fail, p, cat);
}
/** 실패한 사진을 숨기지 않는다. 무엇이 왜 안 됐는지 보여주고 다시 시도할 수 있게 한다. */
async function photoFailReport(okN, fail, p, cat) {
  const byMsg = {};
  for (const f of fail) (byMsg[f.msg] = byMsg[f.msg] || []).push(f.name);
  // 저장 공간이 원인일 수 있으므로 지금 얼마나 쓰고 있는지 함께 보여준다
  let usage = '';
  try {
    const [ph, nt] = await Promise.all([S.store.list('photos'), S.store.list('notes')]);
    const docs = ph.length * 2 + nt.length + S.projects.length + S.trash.length + S.facilities.length + S.fields.length + 2;
    usage = `<p class="hint" style="margin-top:8px">지금 저장소에 문서 약 <b class="mono">${docs}</b>개를 쓰고 있습니다
      (사진 ${ph.length}장 = 문서 ${ph.length * 2}개). 아티팩트 한 개의 한도는 약 5,000개입니다.
      ${docs > 4200 ? '<b style="color:var(--warn)">한도에 가까워졌습니다 — 백업을 내려받고 오래된 사진을 정리해 주세요.</b>' : ''}</p>`;
  } catch (e) { }
  openModal(`<div class="mh"><h3>사진 ${okN}장 저장 · ${fail.length}장 실패</h3><button class="x">×</button></div>
    <div class="mb">
      <p>${okN}장은 저장됐고 <b class="mono">${fail.length}</b>장이 저장되지 않았습니다. 실패한 사진은 <b>아직 올라가지 않았습니다</b> — 아래에서 다시 시도하거나, 원인을 보고 사진을 줄여 다시 올려주세요.</p>
      <div class="tblwrap" style="max-height:260px;border:1px solid var(--line);border-radius:var(--r);margin-top:10px">
        <table class="grid"><thead><tr><th style="cursor:default">원인</th><th style="cursor:default">장수</th><th style="cursor:default">파일</th></tr></thead><tbody>
        ${Object.entries(byMsg).map(([m, names]) => `<tr><td>${esc(m)}</td><td class="n">${names.length}</td>
          <td class="hint">${esc(names.slice(0, 4).join(', '))}${names.length > 4 ? ` 외 ${names.length - 4}` : ''}</td></tr>`).join('')}
        </tbody></table></div>
      <p class="hint" style="margin-top:10px">저장이 몰려서 거절된 경우라면 다시 시도하면 대개 들어갑니다.
      «저장 한도»가 나온 사진은 해상도가 너무 큰 경우이니 줄여서 올려주세요.</p>${usage}
    </div>
    <div class="mf"><button class="btn" onclick="closeModal()">닫기</button>
      <button class="btn pri" id="pfRetry">${fail.length}장 다시 시도</button></div>`);
  $('#pfRetry').onclick = () => { closeModal(); uploadPhotos(fail.map(f => f.file), p, cat); };
}

/* ---------- detail ---------- */
async function openDetail(id) {
  if (S.cur !== id) { PSEL.on = false; PSEL.ids.clear(); PSEL.last = null; }
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
        ${S.photos.length ? `<button class="btn sm" id="galSel">${PSEL.on ? '선택 끝내기' : '선택'}</button>` : ''}
        <select id="upCat" style="width:auto;font-size:12px;padding:3px 6px">${PHOTO_CATS.map(c => `<option>${c}</option>`).join('')}</select>
        <label class="btn sm pri" style="margin:0">＋ 사진 추가<input type="file" id="upFile" accept="image/*" multiple hidden></label></div>
      ${PSEL.on ? bulkBar() : ''}
      ${S.photos.length ? `<div class="gallery${PSEL.on ? ' picking' : ''}" id="gal">${S.photos.map(ph => photoCard(ph)).join('')}</div>`
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
    const files = Array.from(e.target.files || []);
    e.target.value = '';                     // 같은 파일을 다시 고를 수 있게
    if (!files.length) return;
    await uploadPhotos(files, p, $('#upCat').value);
  };
  bindGallery();
}
/* ---------- 갤러리 다중 선택 ----------
   사진을 한 장씩 열어 분류를 고치는 대신, 여러 장을 골라 한 번에 바꾼다.
   답사 한 번에 수십 장을 찍고 돌아오므로 이쪽이 실제 작업 흐름에 맞다. */
const PSEL = { on: false, ids: new Set(), last: null };
function photoCard(ph) {
  const sel = PSEL.ids.has(ph.id);
  return `<div class="ph${sel ? ' selq' : ''}" data-ph="${ph.id}"><img src="${ph.thumb}" alt="${esc(ph.caption || ph.cat)}" loading="lazy">
    ${PSEL.on ? `<span class="pick">${sel ? '✓' : ''}</span>` : ''}
    <span class="badge">${esc(ph.kind === 'elevation' ? '입면' : ph.cat)}</span>
    ${ph.caption ? `<span class="cap">${esc(ph.caption)}</span>` : ''}</div>`;
}
const FACES = ['동', '서', '남', '북', '북동', '북서', '남동', '남서'];
function bulkBar() {
  const n = PSEL.ids.size;
  return `<div class="bulkbar">
    <b>${n ? `${n}장 선택됨` : '사진을 눌러 고르세요'}</b>
    <button class="btn sm" id="bkAll">전체 선택</button>
    <button class="btn sm" id="bkNone" ${n ? '' : 'disabled'}>선택 해제</button>
    <span class="spacer"></span>
    <select id="bkCat" ${n ? '' : 'disabled'}><option value="">카테고리 바꾸기…</option>${PHOTO_CATS.map(c => `<option>${esc(c)}</option>`).join('')}</select>
    <select id="bkFace" ${n ? '' : 'disabled'}><option value="">입면 방향…</option><option value="-">방향 지우기</option>${FACES.map(d => `<option>${d}</option>`).join('')}</select>
    <button class="btn sm" id="bkTag" ${n ? '' : 'disabled'}>태그 추가</button>
    <button class="btn sm" id="bkDate" ${n ? '' : 'disabled'}>촬영일 지정</button>
    <button class="btn sm dgr" id="bkDel" ${n ? '' : 'disabled'}>삭제</button>
  </div>`;
}
function bindGallery() {
  $$('#gal [data-ph]').forEach(el => el.onclick = e => {
    const id = el.dataset.ph;
    if (!PSEL.on) return photoModal(id);
    const order = S.photos.map(x => x.id);
    if (e.shiftKey && PSEL.last && PSEL.last !== id) {
      // 앞서 고른 것과의 사이를 통째로 — 연속 촬영한 구간을 고르는 데 쓴다
      const a = order.indexOf(PSEL.last), b = order.indexOf(id);
      if (a >= 0 && b >= 0) order.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => PSEL.ids.add(x));
    } else {
      PSEL.ids.has(id) ? PSEL.ids.delete(id) : PSEL.ids.add(id);
    }
    PSEL.last = id;
    refreshGallery();
  });
  const sel = $('#galSel');
  if (sel) sel.onclick = () => {
    PSEL.on = !PSEL.on;
    if (!PSEL.on) { PSEL.ids.clear(); PSEL.last = null; }
    renderDetail();
  };
  if (!PSEL.on) return;
  const pick = () => Array.from(PSEL.ids).map(id => S.photos.find(x => x.id === id)).filter(Boolean);
  $('#bkAll').onclick = () => { S.photos.forEach(ph => PSEL.ids.add(ph.id)); refreshGallery(); };
  $('#bkNone').onclick = () => { PSEL.ids.clear(); PSEL.last = null; refreshGallery(); };
  $('#bkCat').onchange = e => { if (e.target.value) bulkPatch(pick(), { cat: e.target.value }, `카테고리를 «${e.target.value}» 로`); };
  $('#bkFace').onchange = e => {
    if (!e.target.value) return;
    const v = e.target.value === '-' ? '' : e.target.value;
    bulkPatch(pick(), { face: v }, v ? `입면 방향을 «${v}» 으로` : '입면 방향을 비움');
  };
  $('#bkTag').onclick = () => {
    openModal(`<div class="mh"><h3>태그 추가 · ${PSEL.ids.size}장</h3><button class="x">×</button></div>
      <div class="mb"><label class="fld"><span>태그 <span class="hint">쉼표로 구분 — 기존 태그에 더해집니다</span></span>
        <input type="text" id="bt_v" placeholder="예) 정면, 재촬영필요"></label></div>
      <div class="mf"><button class="btn pri" id="bt_ok">추가</button></div>`);
    $('#bt_ok').onclick = async () => {
      const add = $('#bt_v').value.split(',').map(t => t.trim()).filter(Boolean);
      if (!add.length) return toast('태그를 입력하세요');
      closeModal();
      const list = pick();
      for (const ph of list) ph.tags = Array.from(new Set((ph.tags || []).concat(add)));
      await bulkPatch(list, null, `태그 «${add.join(', ')}» 를`);
    };
  };
  $('#bkDate').onclick = () => {
    openModal(`<div class="mh"><h3>촬영일 지정 · ${PSEL.ids.size}장</h3><button class="x">×</button></div>
      <div class="mb"><label class="fld"><span>촬영일</span><input type="date" id="bd_v" value="${today()}"></label>
      <p class="hint" style="margin-top:8px">같은 날 답사한 사진의 날짜를 한 번에 맞출 때 씁니다.</p></div>
      <div class="mf"><button class="btn pri" id="bd_ok">적용</button></div>`);
    $('#bd_ok').onclick = () => { const v = $('#bd_v').value; closeModal(); bulkPatch(pick(), { date: v }, `촬영일을 ${v} 로`); };
  };
  $('#bkDel').onclick = async () => {
    const list = pick();
    if (!await confirmBox('사진 삭제', `<p>선택한 <b class="mono">${list.length}</b>장을 삭제합니다. 원본까지 지워지며 되돌릴 수 없습니다.</p>
      <p class="hint">${list.slice(0, 6).map(ph => esc(ph.cat)).join(' · ')}${list.length > 6 ? ' …' : ''}</p>`, `${list.length}장 삭제`)) return;
    for (const ph of list) { await S.store.del('photos', ph.id); await S.store.del('photofull', ph.id); }
    const gone = new Set(list.map(ph => ph.id));
    S.photos = S.photos.filter(x => !gone.has(x.id));
    PSEL.ids.clear(); PSEL.last = null;
    const p = S.projects.find(x => x.id === S.cur);
    if (p) { p.photoCount = S.photos.length; await saveProject(p); }
    renderDetail(); toast(`${list.length}장을 삭제했습니다`);
  };
}
/** 고른 사진에 같은 값을 적용한다. 문서는 통째로 되쓰므로 이 버전이 모르는 필드도 남는다. */
async function bulkPatch(list, patch, what) {
  if (!list.length) return;
  for (const ph of list) {
    if (patch) Object.assign(ph, patch);
    const d = Object.assign({}, ph); delete d.id;
    await putRetry('photos', ph.id, d);
  }
  refreshGallery();
  toast(`${list.length}장의 ${what} 바꿨습니다`);
}
/** 선택 상태만 다시 그린다 — 전체 재렌더보다 가볍고 스크롤이 튀지 않는다 */
function refreshGallery() {
  const gal = $('#gal'); if (!gal) return;
  $$('#gal [data-ph]').forEach(el => {
    const ph = S.photos.find(x => x.id === el.dataset.ph);
    const sel = PSEL.ids.has(el.dataset.ph);
    el.classList.toggle('selq', sel);
    const c = el.querySelector('.pick'); if (c) c.textContent = sel ? '✓' : '';
    const b = el.querySelector('.badge');
    if (b && ph) b.textContent = ph.kind === 'elevation' ? '입면' : ph.cat;   // 분류를 바꾸면 딱지도 함께
  });
  const bar = $('.bulkbar');
  if (bar) { bar.outerHTML = bulkBar(); bindGallery(); }
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
    await putRetry('photos', ph.id, d);
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
    await putRetry('notes', n.id, d);
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
