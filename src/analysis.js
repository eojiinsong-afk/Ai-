/* ============================================================
   분석 · 출력 · 설정
   ============================================================ */
function target() { return S.sel.size ? S.projects.filter(p => S.sel.has(p.id)) : S.projects; }
function distTable() {
  return S.projects.map(p => {
    const n = nearestFacilities(p);
    return {
      p, station: n.station && n.station.d, oldstation: n.oldstation && n.oldstation.d,
      terminal: n.terminal && n.terminal.d, market: n.market && n.market.d
    };
  });
}
function bars(rows, unit) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="bars">${rows.map(r => `<div class="brow"><span class="lbl" title="${esc(r[0])}">${esc(r[0])}</span>
    <span class="bar-t" style="width:${(r[1] / max * 100).toFixed(1)}%;background:${r[2] || 'var(--accent)'}"></span>
    <span class="val">${r[1]}${unit || ''}</span></div>`).join('')}</div>`;
}
function renderAnalysis() {
  const P = S.projects;
  const g = $('#anagrid');
  if (!P.length) { g.innerHTML = `<div class="empty"><h3>분석할 데이터가 아직 없습니다</h3><p>프로젝트를 3–4건만 기록해도 지역 분포와 교통시설 거리 비교가 시작됩니다.</p></div>`; return; }
  const bySido = {}; P.forEach(p => { const k = p.sido || '미상'; bySido[k] = (bySido[k] || 0) + 1; });
  const big = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시'];
  const metro = P.filter(p => big.includes(p.sido)).length;
  const byRel = {}; P.forEach(p => { const k = p.relation || '미분류'; byRel[k] = (byRel[k] || 0) + 1; });
  const byDecade = {}; P.forEach(p => { if (p.builtYear) { const d = Math.floor(p.builtYear / 10) * 10; byDecade[d + 's'] = (byDecade[d + 's'] || 0) + 1; } });
  const D = distTable();
  const withDist = k => D.map(r => r[k]).filter(v => v != null);
  const stat = arr => arr.length ? { n: arr.length, med: arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)], min: Math.min(...arr) } : null;
  const st = stat(withDist('station')), ot = stat(withDist('oldstation')), tm = stat(withDist('terminal'));
  const within = (k, m) => D.filter(r => r[k] != null && r[k] <= m).length;
  g.innerHTML = `
  <div class="card pad">
    <div class="sech"><h3>기록 현황</h3><div class="ln"></div></div>
    <div class="statrow">
      <div class="stat"><b>${P.length}</b><span>프로젝트</span></div>
      <div class="stat"><b>${P.length - metro}</b><span>중소도시·지방</span></div>
      <div class="stat"><b>${Object.keys(bySido).length}</b><span>시·도</span></div>
      <div class="stat"><b>${P.reduce((a, p) => a + (p.photoCount || 0), 0)}</b><span>사진</span></div>
      <div class="stat"><b>${P.reduce((a, p) => a + (p.noteCount || 0), 0)}</b><span>기록</span></div>
    </div>
    <p class="hint" style="margin-top:10px">대도시 사례는 ${metro}건. 지방 중소도시 표본이 ${P.length - metro}건 쌓였습니다.</p>
  </div>
  <div class="card pad">
    <div class="sech"><h3>지역 분포</h3><div class="ln"></div></div>
    ${bars(Object.entries(bySido).sort((a, b) => b[1] - a[1]).map(r => [r[0], r[1], big.includes(r[0]) ? 'var(--faint)' : 'var(--accent)']), '건')}
    <p class="hint" style="margin-top:8px">회색 = 대도시(광역시·특별시), 파랑 = 그 외 지역</p>
  </div>
  <div class="card pad">
    <div class="sech"><h3>시장–주거 결합 유형</h3><div class="ln"></div></div>
    ${bars(Object.entries(byRel).sort((a, b) => b[1] - a[1]), '건')}
  </div>
  ${Object.keys(byDecade).length ? `<div class="card pad"><div class="sech"><h3>건축 연대</h3><div class="ln"></div></div>
    ${bars(Object.entries(byDecade).sort(), '건')}</div>` : ''}
  <div class="card pad">
    <div class="sech"><h3>교통시설과의 거리</h3><div class="ln"></div></div>
    ${S.facilities.length ? `<div class="statrow" style="margin-bottom:10px">
      <div class="stat"><b>${st ? fmtKm(st.med) : '—'}</b><span>현재역 중앙값</span></div>
      <div class="stat"><b>${ot ? fmtKm(ot.med) : '—'}</b><span>과거역 중앙값</span></div>
      <div class="stat"><b>${tm ? fmtKm(tm.med) : '—'}</b><span>터미널 중앙값</span></div>
    </div>
    ${bars([['현재역 500m 내', within('station', 500)], ['현재역 1km 내', within('station', 1000)], ['과거역 500m 내', within('oldstation', 500)], ['과거역 1km 내', within('oldstation', 1000)], ['터미널 1km 내', within('terminal', 1000)], ['시장 300m 내', within('market', 300)]], '건')}
    <p class="hint" style="margin-top:8px">참조 지점 ${S.facilities.length}개 기준. 역·터미널을 더 등록할수록 정확해집니다.</p>`
      : `<p class="hint">아직 참조 지점(기차역·터미널·시장)이 없습니다. 지도에서 지점을 등록하면 모든 프로젝트의 거리가 자동 계산됩니다.</p>
         <button class="btn sm" style="margin-top:8px" onclick="go('map');facilityForm()">＋ 참조 지점 추가</button>`}
  </div>
  <div class="card pad" style="grid-column:1/-1">
    <div class="sech"><h3>프로젝트별 거리표</h3><div class="ln"></div></div>
    <div class="tblwrap" style="max-height:340px"><table class="grid"><thead><tr>
      <th>프로젝트</th><th>지역</th><th>현재역</th><th>과거역</th><th>터미널</th><th>시장</th><th>현재역−과거역</th></tr></thead><tbody>
      ${D.map(r => `<tr><td class="name" data-open="${r.p.id}">${esc(projName(r.p))}</td><td>${esc([r.p.sido, r.p.sgg].filter(Boolean).join(' '))}</td>
        <td class="n">${fmtKm(r.station)}</td><td class="n">${fmtKm(r.oldstation)}</td><td class="n">${fmtKm(r.terminal)}</td><td class="n">${fmtKm(r.market)}</td>
        <td class="n">${r.station != null && r.oldstation != null ? (r.station >= r.oldstation ? '+' : '−') + fmtKm(Math.abs(r.station - r.oldstation)) : '—'}</td></tr>`).join('')}
      </tbody></table></div>
    <p class="hint" style="margin-top:8px">마지막 열이 큰 양수면 <b>현재 철도역에서는 멀지만 과거 역과는 가까운</b> 사례입니다.</p>
  </div>
  <div class="card pad" style="grid-column:1/-1">
    <div class="sech"><h3>유형 가설</h3><div class="ln"></div><span class="hint">규칙 기반 후보 — 연구자 검토용</span></div>
    ${bars(Object.entries(typeHypotheses()).sort((a, b) => b[1] - a[1]), '건')}
    <p class="hint" style="margin-top:8px">등록된 거리·층수·상태 값에서 기계적으로 붙인 후보 유형입니다. 확정된 분류가 아니며, 프로젝트의 태그로 직접 수정해 쓰세요.</p>
  </div>
  <div class="card pad" style="grid-column:1/-1" id="aibox"></div>`;
  $$('#anagrid [data-open]').forEach(t => t.onclick = () => openDetail(t.dataset.open));
  renderAI();
}
function typeHypotheses() {
  const out = {};
  const add = k => out[k] = (out[k] || 0) + 1;
  for (const p of S.projects) {
    const n = nearestFacilities(p);
    const ds = n.station && n.station.d, dos = n.oldstation && n.oldstation.d, dt = n.terminal && n.terminal.d;
    let t = null;
    if (ds != null && ds < 600) t = '철도역 연계형';
    else if (dos != null && dos < 600 && (ds == null || ds > 1500)) t = '과거 철도역 연계형';
    else if (dt != null && dt < 600) t = '버스터미널 연계형';
    if (ds != null && dt != null && ds < 900 && dt < 900) t = '교통결절점형';
    if (!t) t = '전통시장 중심형';
    if ((p.aptFloors || 0) >= 5 && (p.marketFloors || 0) <= 2) t += ' · 수직결합';
    if (p.status && /공실|폐쇄|철거/.test(p.status)) t = '시장 쇠퇴형';
    add(t);
  }
  return out;
}
function renderAI() {
  const box = $('#aibox');
  if (!box) return;
  if (!S.sample) {
    box.innerHTML = `<div class="sech"><h3>AI 연구 보조</h3><div class="ln"></div></div>
      <p class="hint">이 화면에서는 AI 질의를 사용할 수 없습니다. 데이터를 CSV로 내보내 대화창에서 물어보세요.</p>`;
    return;
  }
  box.innerHTML = `<div class="sech"><h3>AI 연구 보조</h3><div class="ln"></div><span class="hint">기록된 데이터만 근거로 답합니다</span></div>
    <div id="aithread"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input type="text" id="aiq" placeholder="예) 현재 철도역에서는 멀지만 과거 철도역과 가까운 사례를 찾아줘">
      <button class="btn pri" id="aigo">질문</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${['철도역과 가까운 사례들의 공통점을 찾아줘', '대도시와 지방 사례의 차이를 비교해줘', '이 데이터에서 새로운 유형이 보이는지 분석해줘', '아파트 5층 이상 · 시장 2층 이하 사례만 정리해줘'].map(q => `<button class="chip" data-aiq="${esc(q)}">${esc(q)}</button>`).join('')}
    </div>`;
  const ask = async q => {
    if (!q.trim()) return;
    const th = $('#aithread');
    th.insertAdjacentHTML('beforeend', `<div class="aimsg q">${esc(q)}</div>`);
    const slot = document.createElement('div'); slot.className = 'aimsg'; slot.textContent = '생각 중…';
    th.appendChild(slot);
    const rows = S.projects.map(p => {
      const n = nearestFacilities(p);
      return {
        이름: projName(p), 시도: p.sido, 시군구: p.sgg, 주소: p.address, 답사일: p.surveyDate, 건축연도: p.builtYear,
        시장층: p.marketFloors, 아파트층: p.aptFloors, 전체층: p.totalFloors, 주차장: p.parking ? '있음' : '없음',
        결합유형: p.relation, 상태: p.status, 태그: (p.tags || []).join('/'),
        현재역m: n.station ? Math.round(n.station.d) : null, 과거역m: n.oldstation ? Math.round(n.oldstation.d) : null,
        터미널m: n.terminal ? Math.round(n.terminal.d) : null, 시장m: n.market ? Math.round(n.market.d) : null,
        비고: (p.note || '').slice(0, 200)
      };
    });
    try {
      const r = await S.sample(`당신은 건축학 논문(시장아파트 연구)을 돕는 연구 보조입니다.
아래 JSON은 연구자가 직접 답사해 기록한 시장아파트 데이터입니다. 이 데이터에 있는 값만 근거로 한국어로 간결하게 답하세요.
규칙: (1) 데이터에 없는 사실을 추측해 단정하지 말 것 (2) 결론은 '가설'로 제시하고 연구자가 검토하도록 할 것 (3) 답변 끝에 "근거: 프로젝트명 나열" 형식으로 어떤 항목을 근거로 삼았는지 밝힐 것 (4) 표본이 적으면 그 한계를 먼저 언급할 것.

데이터(${rows.length}건): ${JSON.stringify(rows)}

질문: ${q}`, { onText: ({ text }) => { slot.textContent = text; th.scrollTop = th.scrollHeight; } });
      slot.textContent = r.text;
    } catch (e) {
      slot.textContent = e && e.code === 'rate_limited' ? '요청이 몰렸습니다. 잠시 후 다시 시도하세요.' : 'AI 응답을 받지 못했습니다.';
    }
  };
  $('#aigo').onclick = () => { const v = $('#aiq').value; $('#aiq').value = ''; ask(v); };
  $('#aiq').onkeydown = e => { if (e.key === 'Enter') $('#aigo').click(); };
  $$('[data-aiq]').forEach(b => b.onclick = () => ask(b.dataset.aiq));
}
$('#anaRefresh').onclick = () => renderAnalysis();

/* ---------- 비교 ---------- */
$('#btnCompare').onclick = async () => {
  const ps = S.projects.filter(p => S.sel.has(p.id));
  if (!ps.length) return;
  const photos = {};
  for (const p of ps) photos[p.id] = (await S.store.list('photos', ['pid', '==', p.id])).slice(0, 4);
  const fields = BASE_FIELDS.filter(f => !['tags', 'note', 'lat', 'lng'].includes(f.k))
    .concat(S.fields.map(f => ({ k: 'c_' + f.id, label: f.label, custom: f.id, type: f.type })));
  const val = (p, f) => { let v = fieldValue(p, f); if (f.type === 'bool') v = v ? '있음' : (v === false ? '없음' : ''); return Array.isArray(v) ? v.join(', ') : v; };
  openModal(`<div class="mh"><h3>프로젝트 비교 · ${ps.length}건</h3><button class="x">×</button></div>
    <div class="mb"><div class="tblwrap"><table class="grid"><thead><tr><th class="stickycol">항목</th>${ps.map(p => `<th>${esc(projName(p))}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><td class="stickycol">사진</td>${ps.map(p => `<td><div style="display:flex;gap:3px">${(photos[p.id] || []).map(ph => `<img src="${ph.thumb}" style="width:54px;height:40px;object-fit:cover;border-radius:3px" alt="">`).join('') || '<span class="hint">—</span>'}</div></td>`).join('')}</tr>
      ${fields.map(f => `<tr><td class="stickycol">${esc(f.label)}</td>${ps.map(p => `<td>${esc(val(p, f))}</td>`).join('')}</tr>`).join('')}
      <tr><td class="stickycol">현재역 거리</td>${ps.map(p => { const n = nearestFacilities(p); return `<td class="n">${fmtKm(n.station && n.station.d)}</td>`; }).join('')}</tr>
      <tr><td class="stickycol">과거역 거리</td>${ps.map(p => { const n = nearestFacilities(p); return `<td class="n">${fmtKm(n.oldstation && n.oldstation.d)}</td>`; }).join('')}</tr>
      <tr><td class="stickycol">터미널 거리</td>${ps.map(p => { const n = nearestFacilities(p); return `<td class="n">${fmtKm(n.terminal && n.terminal.d)}</td>`; }).join('')}</tr>
    </tbody></table></div></div>
    <div class="mf"><button class="btn" id="cmpCsv">CSV로 내보내기</button><button class="btn" id="cmpPpt">PPT 만들기</button><button class="btn pri" id="cmpRep">보고서 만들기</button></div>`, { wide: true });
  $('#cmpCsv').onclick = () => exportCsv(ps);
  $('#cmpRep').onclick = () => { closeModal(); buildReport(ps); };
  $('#cmpPpt').onclick = () => { closeModal(); pptxDialog(ps); };
};

/* ---------- CSV ---------- */
function csvCell(v) { const s = v == null ? '' : Array.isArray(v) ? v.join('/') : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function exportCsv(list) {
  const ps = list || target();
  const fields = BASE_FIELDS.concat(S.fields.map(f => ({ k: 'c_' + f.id, label: f.label, custom: f.id, type: f.type })));
  const head = fields.map(f => f.label).concat(['현재역m', '과거역m', '터미널m', '시장m', '사진수', '기록수']);
  const rows = ps.map(p => {
    const n = nearestFacilities(p);
    return fields.map(f => {
      let v = fieldValue(p, f);
      if (f.type === 'bool') v = v === true ? '있음' : v === false ? '없음' : '';
      return csvCell(v);
    }).concat([n.station ? Math.round(n.station.d) : '', n.oldstation ? Math.round(n.oldstation.d) : '', n.terminal ? Math.round(n.terminal.d) : '', n.market ? Math.round(n.market.d) : '', p.photoCount || 0, p.noteCount || 0]);
  });
  const csv = '﻿' + [head.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n');
  download(`시장아파트_데이터_${today()}.csv`, csv, 'text/csv');
}

/* ---------- 보고서 / 발표자료 (인쇄 → PDF) ---------- */
async function collect(ps) {
  const out = [];
  for (const p of ps) {
    const photos = (await S.store.list('photos', ['pid', '==', p.id])).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const notes = (await S.store.list('notes', ['pid', '==', p.id])).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    out.push({ p, photos, notes, near: nearestFacilities(p) });
  }
  return out;
}
/** 사례별 위치 지도 이미지를 붙인다 (지도 생성이 실패해도 보고서는 그대로 나온다) */
async function attachMaps(data, W, H) {
  for (const d of data) {
    if (d.p.lat == null) continue;
    try { d.mapImg = await mapImage({ items: [d.p], all: S.projects, W: W || 560, H: H || 380 }); }
    catch (e) { console.warn(e); }
  }
  return data;
}
function infoTable(p, near) {
  const rows = [
    ['시장 / 시장아파트', [p.marketName, p.aptName].filter(Boolean).join(' / ')],
    ['소재지', [p.sido, p.sgg, p.address].filter(Boolean).join(' ')],
    ['좌표', p.lat != null ? p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) : ''],
    ['답사일', p.surveyDate], ['건축연도', p.builtYear], ['리모델링·증축', p.remodel],
    ['층수 (시장 / 아파트 / 전체)', [p.marketFloors, p.aptFloors, p.totalFloors].map(v => v == null ? '?' : v).join(' / ')],
    ['주차장', (p.parking ? '있음' : '없음') + (p.parkingType ? ' · ' + p.parkingType : '')],
    ['시장–주거 관계', p.relation], ['현재 상태', p.status],
    ['인접 철도역', (p.nearStation || '') + (near.station ? ` (${fmtKm(near.station.d)})` : '')],
    ['인접 버스터미널', (p.nearTerminal || '') + (near.terminal ? ` (${fmtKm(near.terminal.d)})` : '')],
    ['과거 철도역', near.oldstation ? `${near.oldstation.f.name || ''} (${fmtKm(near.oldstation.d)})` : ''],
    ['태그', (p.tags || []).join(', ')]
  ].concat(S.fields.map(f => [f.label, (p.custom || {})[f.id]]));
  return `<table>${rows.filter(r => r[1] != null && r[1] !== '').map(r => `<tr><th style="width:150px">${esc(r[0])}</th><td>${esc(Array.isArray(r[1]) ? r[1].join(', ') : r[1])}</td></tr>`).join('')}</table>`;
}
async function buildReport(list) {
  const ps = list || target();
  toast('보고서를 만드는 중…');
  const data = await attachMaps(await collect(ps));
  const root = $('#printroot');
  let distImg = '', locImg = '';
  try {
    distImg = await mapImage({ all: S.projects, items: ps, whole: true, W: 620, H: 470 });
    if (ps.some(p => p.lat != null)) locImg = await mapImage({ all: S.projects, items: ps, labels: true, W: 620, H: 400 });
  } catch (e) { console.warn('지도 이미지 생략', e); }
  root.innerHTML = `<div style="padding-bottom:20px">
      <p class="mono" style="font-size:11px;letter-spacing:.1em">MARKET–HOUSING COMPLEX / FIELD SURVEY</p>
      <h1>시장아파트 답사 보고서</h1>
      <p style="font-size:12px;color:#444">${ps.length}개 사례 · 작성일 ${today()}</p>
      ${distImg ? `<h2>분포</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <figure style="margin:0"><img src="${distImg}" style="width:100%;border:1px solid #ccc"><figcaption style="font-size:9px;color:#555">전국 분포 — 네모가 이 보고서의 사례</figcaption></figure>
        ${locImg ? `<figure style="margin:0"><img src="${locImg}" style="width:100%;border:1px solid #ccc"><figcaption style="font-size:9px;color:#555">사례 위치</figcaption></figure>` : ''}
      </div>` : ''}
      <table style="margin-top:12px"><tr><th>사례</th><th>소재지</th><th>답사일</th><th>층수</th><th>현재역</th><th>과거역</th></tr>
      ${data.map(d => `<tr><td>${esc(projName(d.p))}</td><td>${esc([d.p.sido, d.p.sgg].filter(Boolean).join(' '))}</td><td>${esc(d.p.surveyDate || '')}</td>
        <td>${d.p.marketFloors || '?'}+${d.p.aptFloors || '?'}</td><td>${fmtKm(d.near.station && d.near.station.d)}</td><td>${fmtKm(d.near.oldstation && d.near.oldstation.d)}</td></tr>`).join('')}</table>
    </div>` +
    data.map(d => `<div class="prj">
      <h1>${esc(projName(d.p))}</h1>
      <p style="font-size:12px;color:#444">${esc([d.p.sido, d.p.sgg, d.p.marketName].filter(Boolean).join(' · '))}</p>
      <h2>기본 정보</h2>${infoTable(d.p, d.near)}
      ${d.mapImg ? `<h2>위치</h2><img src="${d.mapImg}" style="width:58%;border:1px solid #ccc">
        <p style="font-size:9px;color:#555;margin:2px 0 0">반경 약 2km · 사각형이 대상 건물, 원·삼각형·마름모가 역·터미널·시장</p>` : ''}
      ${d.photos.length ? `<h2>현장 사진</h2><div class="pgal">${d.photos.slice(0, 9).map(ph => `<figure><img src="${ph.thumb}" alt=""><figcaption>${esc(ph.cat)}${ph.caption ? ' — ' + esc(ph.caption) : ''}</figcaption></figure>`).join('')}</div>` : ''}
      ${d.notes.length ? `<h2>답사 기록</h2>${d.notes.map(n => `<div style="margin-bottom:8px"><b>${esc(n.title || '무제')}</b> <span style="font-size:10px;color:#666">${esc(n.date || '')} ${esc(n.kind || '')}</span>
        <div style="font-size:11px;white-space:pre-wrap">${esc(n.body || '')}</div></div>`).join('')}` : ''}
      ${d.p.note ? `<h2>비고</h2><p style="font-size:11px;white-space:pre-wrap">${esc(d.p.note)}</p>` : ''}
    </div>`).join('');
  setTimeout(() => window.print(), 350);
}
async function buildSlides(list) {
  const ps = list || target();
  toast('발표자료를 만드는 중…');
  const data = await attachMaps(await collect(ps), 520, 360);
  const S16 = 'width:100%;aspect-ratio:16/9;border:1px solid #ccc;padding:22px;margin-bottom:10px;display:flex;flex-direction:column;overflow:hidden';
  const root = $('#printroot');
  const bySido = {}; ps.forEach(p => { const k = p.sido || '미상'; bySido[k] = (bySido[k] || 0) + 1; });
  root.innerHTML = `
    <div class="slide" style="${S16};justify-content:center">
      <p class="mono" style="font-size:11px;letter-spacing:.14em">MARKET–HOUSING COMPLEX</p>
      <h1 style="font-size:34px;margin:6px 0">시장아파트 답사 보고</h1>
      <p style="color:#555">${ps.length}개 사례 · ${Object.keys(bySido).length}개 시·도 · ${today()}</p></div>
    <div class="slide" style="${S16}">
      <h1 style="font-size:22px">연구 개요</h1>
      <p style="font-size:13px;line-height:1.7">시장과 주거가 하나의 건축물로 결합된 <b>시장아파트</b>를 전국 단위로 답사·기록하고,
      입지(철도역·버스터미널·시장과의 거리), 도시적 배치, 시장–주거의 결합 방식, 규모, 현재 상태를 비교한다.
      특히 대도시 사례에 편중되지 않도록 중소도시·지방 사례를 함께 수집한다.</p>
      <table style="margin-top:10px"><tr><th>지역</th><th>사례 수</th></tr>
      ${Object.entries(bySido).sort((a, b) => b[1] - a[1]).map(r => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td></tr>`).join('')}</table></div>
    ${data.map(d => `
      <div class="slide" style="${S16}">
        <h1 style="font-size:22px">${esc(projName(d.p))}</h1>
        <p style="font-size:12px;color:#555">${esc([d.p.sido, d.p.sgg, d.p.address].filter(Boolean).join(' '))}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:1;min-height:0">
          <div>${infoTable(d.p, d.near)}</div>
          <div class="pgal" style="grid-template-columns:1fr 1fr">${d.photos.slice(0, 4).map(ph => `<figure><img src="${ph.thumb}" alt=""><figcaption>${esc(ph.cat)}</figcaption></figure>`).join('')}</div>
        </div></div>
      ${d.notes.length ? `<div class="slide" style="${S16}"><h1 style="font-size:20px">${esc(projName(d.p))} — 답사 기록</h1>
        ${d.notes.slice(0, 6).map(n => `<div style="margin-bottom:6px"><b style="font-size:13px">${esc(n.title || '무제')}</b>
          <div style="font-size:11px;white-space:pre-wrap">${esc((n.body || '').slice(0, 700))}</div></div>`).join('')}</div>` : ''}`).join('')}
    <div class="slide" style="${S16}">
      <h1 style="font-size:22px">유형 가설</h1>
      <table><tr><th>유형 후보</th><th>사례 수</th></tr>
      ${Object.entries(typeHypotheses()).sort((a, b) => b[1] - a[1]).map(r => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td></tr>`).join('')}</table>
      <p style="font-size:11px;color:#666;margin-top:8px">거리·층수·상태 값에서 기계적으로 도출한 후보이며, 연구자의 검토가 필요한 가설이다.</p></div>`;
  setTimeout(() => window.print(), 350);
}
$('#btnReport').onclick = () => buildReport(S.projects.filter(p => S.sel.has(p.id)));
$('#btnSlides').onclick = () => pptxDialog(S.projects.filter(p => S.sel.has(p.id)));
$('#detReport').onclick = () => buildReport(S.projects.filter(p => p.id === S.cur));

/* ---------- 출력 화면 ---------- */
function renderOutput() {
  updateSelStat();
  const n = S.sel.size || S.projects.length;
  $('#outpad').innerHTML = `
    <div class="anagrid" style="padding:0">
      <div class="card pad"><div class="sech"><h3>데이터</h3><div class="ln"></div></div>
        <p class="hint">모든 항목과 자동 계산된 교통시설 거리를 포함한 표입니다. 엑셀에서 바로 열립니다.</p>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn pri" id="oCsv">CSV 내보내기 (${n}건)</button>
          <button class="btn" id="oJson">전체 백업 (JSON)</button></div></div>
      <div class="card pad"><div class="sech"><h3>답사 보고서</h3><div class="ln"></div></div>
        <p class="hint">사례별 기본정보·사진·답사 기록을 A4 문서로 배치합니다. 인쇄 대화상자에서 <b>PDF로 저장</b>을 선택하세요.</p>
        <button class="btn pri" style="margin-top:10px" id="oRep">보고서 만들기 (${n}건)</button></div>
      <div class="card pad"><div class="sech"><h3>세미나 발표자료</h3><div class="ln"></div></div>
        <p class="hint">표지 · 연구 개요 · 전국 분포 지도 · 사례별 정보와 사진 · 입면 · 답사 기록 · 교통시설 · 비교 · 유형 가설.
        넣을 슬라이드를 직접 고를 수 있고, <b>파워포인트에서 그대로 편집되는 .pptx</b> 파일로 나옵니다.</p>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn pri" id="oPptx">PPT 만들기 (${n}건)</button>
          <button class="btn" id="oSlide">PDF 슬라이드</button></div></div>
      <div class="card pad"><div class="sech"><h3>선택</h3><div class="ln"></div></div>
        <p class="hint">프로젝트 화면에서 체크한 항목만 출력 대상이 됩니다. 선택이 없으면 전체가 대상입니다.</p>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" onclick="go('list')">프로젝트에서 선택</button>
        <button class="btn" id="oClear">선택 해제</button></div></div>
    </div>`;
  $('#oCsv').onclick = () => exportCsv();
  $('#oRep').onclick = () => buildReport();
  $('#oSlide').onclick = () => buildSlides();
  $('#oPptx').onclick = () => pptxDialog(target());
  $('#oJson').onclick = () => backup();
  $('#oClear').onclick = () => { S.sel.clear(); renderOutput(); renderTable(); MAP.draw(); };
}
async function backup() {
  toast('백업을 만드는 중…');
  const [photos, notes] = await Promise.all([S.store.list('photos'), S.store.list('notes')]);
  const full = {};
  for (const ph of photos) { const f = await S.store.get('photofull', ph.id); if (f) full[ph.id] = f.data; }
  const blob = new Blob([JSON.stringify({
    format: 'mkt-archive', appVersion: APP_VERSION, schemaVersion: (S.meta && S.meta.schemaVersion) || SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    projects: S.projects, facilities: S.facilities, fields: S.fields, photos, notes, photofull: full
  })], { type: 'application/json' });
  download(`시장아파트_백업_${today()}.json`, blob);
}
/** 백업 복원. 어떤 경우에도 기존 데이터를 지우지 않는다.
 *  같은 ID가 이미 있으면 mode에 따라 건너뛰거나(기본) 덮어쓴다. */
async function restore(file) {
  const d = JSON.parse(await file.text());
  if (!d.projects) throw new Error('형식이 올바르지 않습니다');
  const existing = new Set(S.projects.map(p => p.id).concat(S.trash.map(p => p.id)));
  const dupes = d.projects.filter(p => existing.has(p.id)).length;
  const mode = await new Promise(res => {
    openModal(`<div class="mh"><h3>백업 복원</h3><button class="x">×</button></div>
      <div class="mb"><p>백업 파일에 프로젝트 <b class="mono">${d.projects.length}</b>건, 사진 <b class="mono">${(d.photos || []).length}</b>장이 들어 있습니다.
      ${dupes ? `그중 <b class="mono">${dupes}</b>건은 지금 저장소에 <b>같은 ID로 이미 존재</b>합니다.` : '지금 저장소와 겹치는 항목은 없습니다.'}</p>
      <p class="hint">현재 저장된 프로젝트 ${S.projects.length}건은 어떤 선택을 해도 삭제되지 않습니다. 복원은 항상 추가·병합 방식으로만 동작합니다.</p></div>
      <div class="mf"><button class="btn" data-m="">취소</button>
        <button class="btn" data-m="over" ${dupes ? '' : 'disabled'}>겹치는 항목 덮어쓰기</button>
        <button class="btn pri" data-m="skip">겹치는 항목 유지하고 새 항목만 추가</button></div>`);
    $$('#modalbox [data-m]').forEach(b => b.onclick = () => { closeModal(); res(b.dataset.m); });
  });
  if (!mode) return;
  const keep = mode === 'skip';
  let added = 0, skipped = 0;
  const put = async (coll, id, data, exists) => {
    if (exists && keep) { skipped++; return; }
    await S.store.put(coll, id, stripId(data)); added++;
  };
  for (const p of d.projects) await put('projects', p.id, p, existing.has(p.id));
  for (const f of (d.facilities || [])) await put('facilities', f.id, f, S.facilities.some(x => x.id === f.id));
  for (const f of (d.fields || [])) await put('fields', f.id, f, S.fields.some(x => x.id === f.id));
  const curNotes = new Set((await S.store.list('notes')).map(x => x.id));
  for (const n of (d.notes || [])) await put('notes', n.id, n, curNotes.has(n.id));
  const curPhotos = new Set((await S.store.list('photos')).map(x => x.id));
  for (const ph of (d.photos || [])) {
    const ex = curPhotos.has(ph.id);
    await put('photos', ph.id, ph, ex);
    if (!(ex && keep) && d.photofull && d.photofull[ph.id]) await S.store.put('photofull', ph.id, { data: d.photofull[ph.id] });
  }
  await loadAll(); await runMigrations(); MAP.draw(); updateCounts(); renderTable();
  toast(`복원 완료 · ${added}건 반영${skipped ? `, ${skipped}건은 기존 데이터 유지` : ''}`, 4200);
}

/* ---------- 설정 ---------- */
const FIELD_TYPES = { text: '텍스트', number: '숫자', date: '날짜', bool: '예/아니오', select: '선택형', multi: '다중 선택', long: '긴 텍스트' };
async function renderSettings() {
  const photos = await S.store.list('photos');
  const totalBytes = photos.reduce((a, p) => a + (p.size || 0) + (p.thumb ? p.thumb.length : 0), 0);
  const dup = {}; photos.forEach(p => { const k = (p.w || 0) + 'x' + (p.h || 0) + '|' + (p.thumb || '').slice(-64); (dup[k] = dup[k] || []).push(p); });
  const dups = Object.values(dup).filter(a => a.length > 1);
  const lowres = photos.filter(p => Math.max(p.w || 0, p.h || 0) < 900);
  $('#setpad').innerHTML = `
  <div class="anagrid" style="padding:0">
    <div class="card pad" style="grid-column:1/-1">
      <div class="sech"><h3>사용자 정의 항목</h3><div class="ln"></div><button class="btn sm pri" id="cfAdd">＋ 항목 추가</button></div>
      <p class="hint">연구가 진행되며 새 분석 기준이 생기면 항목을 추가하세요. 모든 프로젝트의 표와 상세 화면에 함께 나타납니다.</p>
      <div style="margin-top:10px">${S.fields.length ? `<table class="grid" style="width:100%"><thead><tr><th>항목</th><th>형식</th><th>선택지</th><th></th></tr></thead><tbody>
        ${S.fields.map(f => `<tr><td>${esc(f.label)}</td><td>${FIELD_TYPES[f.type] || f.type}</td><td>${esc((f.options || []).join(', '))}</td>
          <td><button class="btn sm" data-cfe="${f.id}">편집</button> <button class="btn sm dgr" data-cfd="${f.id}">삭제</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="hint">예) 시장 형태 · 아파트 진입 방식 · 상부 주거동 형태 · 대지 형태 · 아케이드 유무 · 공실 여부</p>'}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${['시장 형태', '아파트 진입 방식', '상부 주거동 형태', '건물 배치', '대지 형태', '도로 접면', '광장 유무', '아케이드 유무', '건물 구조', '공실 여부'].map(s => `<button class="chip" data-quick="${esc(s)}">＋ ${esc(s)}</button>`).join('')}
      </div>
    </div>
    <div class="card pad"><div class="sech"><h3>참조 지점</h3><div class="ln"></div><button class="btn sm" id="stFac">＋ 추가</button></div>
      ${Object.entries(FAC_KINDS).filter(([k]) => k !== 'apt').map(([k, v]) => `<div class="dist"><span>${v.label}</span><span class="d">${S.facilities.filter(f => f.kind === k).length}</span></div>`).join('')}
      <p class="hint" style="margin-top:8px">과거 철도역은 위치와 함께 <b>연도·출처</b>를 메모에 남겨두면 나중에 논문 각주로 쓸 수 있습니다.</p></div>
    <div class="card pad"><div class="sech"><h3>저장 공간</h3><div class="ln"></div></div>
      <div class="statrow"><div class="stat"><b>${photos.length}</b><span>사진</span></div>
        <div class="stat"><b>${bytes(totalBytes)}</b><span>이미지 용량</span></div>
        <div class="stat"><b>${S.projects.length}</b><span>프로젝트</span></div></div>
      <div style="margin-top:10px">${bars(S.projects.map(p => [projName(p), p.photoCount || 0]).sort((a, b) => b[1] - a[1]).slice(0, 8), '장')}</div>
      <p class="hint" style="margin-top:8px">${S.store && S.store.name === 'db' ? '사진은 계정 저장소에 저장되어 다른 기기에서도 열립니다. 사진 1장은 약 150–230KB로 자동 압축됩니다.' : '이 브라우저에만 저장됩니다. 정기적으로 JSON 백업을 내려받으세요.'}</p></div>
    <div class="card pad"><div class="sech"><h3>정리</h3><div class="ln"></div></div>
      <div class="dist"><span>중복 의심 사진</span><span class="d">${dups.reduce((a, g) => a + g.length - 1, 0)}</span></div>
      <div class="dist"><span>저해상도 사진 (900px 미만)</span><span class="d">${lowres.length}</span></div>
      <div class="dist"><span>휴지통</span><span class="d">${S.trash.length}</span></div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn sm" id="stDup" ${dups.length ? '' : 'disabled'}>중복 사진 검토</button>
        <button class="btn sm" id="stTrash" ${S.trash.length ? '' : 'disabled'}>휴지통 열기</button></div></div>
    <div class="card pad"><div class="sech"><h3>백업 · 복원</h3><div class="ln"></div></div>
      <p class="hint">사진 원본까지 포함한 전체 백업입니다. 복원은 항상 병합 방식이며, 지금 저장된 기록을 지우지 않습니다.</p>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" id="stBk">백업 내려받기</button>
        <label class="btn" style="margin:0">복원<input type="file" id="stRs" accept="application/json" hidden></label></div></div>
    <div class="card pad" style="grid-column:1/-1">
      <div class="sech"><h3>데이터 안전</h3><div class="ln"></div><button class="btn sm" id="stCheck">무결성 점검</button></div>
      <div class="statrow" style="margin-bottom:10px">
        <div class="stat"><b>v${(S.meta && S.meta.schemaVersion) || 0}</b><span>데이터 구조</span></div>
        <div class="stat"><b>${APP_VERSION}</b><span>앱 버전</span></div>
        <div class="stat"><b>${S.projects.length + S.trash.length}</b><span>보존 중인 프로젝트</span></div>
        <div class="stat"><b>${photos.length}</b><span>사진 문서</span></div>
      </div>
      <p class="hint" style="margin:0 0 8px">앱 코드와 데이터는 분리되어 있습니다. 화면이나 기능을 고쳐 다시 배포해도 저장소는 그대로 남고,
      모든 프로젝트는 처음 만들 때 받은 <b>영구 고유 ID</b>로 계속 식별됩니다. 저장할 때는 불러온 문서 전체를 되쓰기 때문에,
      이 버전이 모르는 항목이 있어도 지워지지 않습니다.</p>
      <p class="hint" style="margin:0 0 8px">저장 구조가 바뀌면 값을 <b>채우기만 하는</b> 마이그레이션이 실행되고, 실행 직전 프로젝트 목록의 스냅샷을 따로 남깁니다.
      기존 값을 지우거나 덮어쓰는 마이그레이션은 두지 않습니다.
      ${S.schemaAhead ? '<b style="color:var(--warn)">저장된 데이터가 이 앱 버전보다 최신입니다. 구조 변경 없이 읽기만 하고 있습니다.</b>' : ''}</p>
      ${(S.meta && S.meta.migrations && S.meta.migrations.length)
      ? `<div class="tblwrap" style="max-height:180px"><table class="grid"><thead><tr><th>버전</th><th>내용</th><th>실행 시각</th><th>변경 문서</th></tr></thead><tbody>
          ${S.meta.migrations.slice().reverse().map(m => `<tr><td class="n">v${m.v}</td><td>${esc(m.name)}</td><td class="n">${esc((m.at || '').slice(0, 16).replace('T', ' '))}</td>
            <td class="n">${m.error ? '<span style="color:var(--signal)">실패</span>' : m.changed}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">아직 실행된 마이그레이션이 없습니다.</p>'}
    </div>
  </div>`;
  $('#cfAdd').onclick = () => fieldForm();
  $$('[data-quick]').forEach(b => b.onclick = () => fieldForm({ id: uid(), label: b.dataset.quick, type: 'text', options: [] }));
  $$('[data-cfe]').forEach(b => b.onclick = () => fieldForm(S.fields.find(f => f.id === b.dataset.cfe)));
  $$('[data-cfd]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('항목 삭제', '<p>이 항목을 삭제합니다. 각 프로젝트에 입력된 값은 남아 있지만 화면에는 보이지 않습니다.</p>')) return;
    await S.store.del('fields', b.dataset.cfd); S.fields = S.fields.filter(f => f.id !== b.dataset.cfd);
    renderSettings(); renderTable();
  });
  $('#stFac').onclick = () => facilityForm();
  $('#stBk').onclick = () => backup();
  $('#stRs').onchange = async e => { try { await restore(e.target.files[0]); renderSettings(); } catch (err) { toast('복원 실패: ' + err.message); } };
  $('#stTrash').onclick = () => trashModal();
  $('#stDup').onclick = () => dupModal(dups);
  $('#stCheck').onclick = () => integrityCheck();
}
/** 데이터 무결성 점검 — 읽기 전용. 어떤 것도 자동으로 고치거나 지우지 않는다. */
async function integrityCheck() {
  const [photos, notes, fulls] = await Promise.all([S.store.list('photos'), S.store.list('notes'), S.store.list('photofull')]);
  const live = new Set(S.projects.map(p => p.id));
  const trashed = new Set(S.trash.map(p => p.id));
  const known = id => live.has(id) || trashed.has(id);
  const fullIds = new Set(fulls.map(f => f.id));
  const noId = S.projects.filter(p => !p.id).length;
  const orphanPhotos = photos.filter(p => !known(p.pid));
  const orphanNotes = notes.filter(n => !known(n.pid));
  const missingFull = photos.filter(p => !fullIds.has(p.id));
  const strayFull = fulls.filter(f => !photos.some(p => p.id === f.id));
  const row = (label, n, good) => `<div class="dist"><span>${label}</span><span class="d" style="color:${n === 0 || good ? 'var(--ok)' : 'var(--warn)'}">${n === 0 ? '이상 없음' : n + '건'}</span></div>`;
  openModal(`<div class="mh"><h3>데이터 무결성 점검</h3><button class="x">×</button></div>
    <div class="mb">
      <div class="statrow" style="margin-bottom:12px">
        <div class="stat"><b>${S.projects.length}</b><span>활성 프로젝트</span></div>
        <div class="stat"><b>${S.trash.length}</b><span>휴지통</span></div>
        <div class="stat"><b>${photos.length}</b><span>사진</span></div>
        <div class="stat"><b>${notes.length}</b><span>답사 기록</span></div>
        <div class="stat"><b>v${(S.meta && S.meta.schemaVersion) || 0}</b><span>구조</span></div>
      </div>
      ${row('고유 ID가 없는 프로젝트', noId)}
      ${row('소속 프로젝트가 사라진 사진', orphanPhotos.length)}
      ${row('소속 프로젝트가 사라진 기록', orphanNotes.length)}
      ${row('원본이 없는 사진 문서', missingFull.length)}
      ${row('메타 정보가 없는 원본 이미지', strayFull.length)}
      <p class="hint" style="margin-top:10px">점검은 읽기만 합니다. 문제가 발견돼도 아무것도 자동으로 지우지 않습니다.
      ${orphanPhotos.length || orphanNotes.length ? '고아 항목은 휴지통에서 프로젝트를 복원하면 다시 연결됩니다.' : ''}</p>
      <p class="hint">저장소: <b>${S.store.name === 'db' ? '계정 저장소 (기기 간 동기화)' : '이 브라우저 (IndexedDB)'}</b> · 처음 사용: ${esc(((S.meta && S.meta.firstRunAt) || '').slice(0, 10) || '—')}</p>
    </div>
    <div class="mf"><button class="btn" id="icBk">지금 백업 내려받기</button><button class="btn pri" onclick="closeModal()">닫기</button></div>`);
  $('#icBk').onclick = () => { closeModal(); backup(); };
}
function fieldForm(f) {
  const isNew = !f || !S.fields.find(x => x.id === f.id);
  f = f || { id: uid(), label: '', type: 'text', options: [] };
  openModal(`<div class="mh"><h3>${isNew ? '항목 추가' : '항목 편집'}</h3><button class="x">×</button></div>
    <div class="mb"><div class="formgrid">
      <label class="fld"><span>항목 이름</span><input type="text" id="cf_l" value="${esc(f.label)}" placeholder="예) 아파트 진입 방식"></label>
      <label class="fld"><span>형식</span><select id="cf_t">${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="fld" style="margin-top:10px"><span>선택지 <span class="hint">선택형·다중 선택일 때, 쉼표로 구분</span></span>
      <input type="text" id="cf_o" value="${esc((f.options || []).join(', '))}" placeholder="예) 외부계단, 시장 내부 계단, 별동 코어"></label></div>
    <div class="mf"><button class="btn pri" id="cf_ok">저장</button></div>`);
  $('#cf_ok').onclick = async () => {
    f.label = $('#cf_l').value.trim(); f.type = $('#cf_t').value;
    f.options = $('#cf_o').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!f.label) return toast('항목 이름을 입력하세요');
    if (!f.order) f.order = S.fields.length + 1;
    await S.store.put('fields', f.id, f);
    const i = S.fields.findIndex(x => x.id === f.id);
    if (i < 0) S.fields.push(f); else S.fields[i] = f;
    closeModal(); renderSettings(); renderTable(); toast('저장했습니다');
  };
}
function trashModal() {
  openModal(`<div class="mh"><h3>휴지통 · ${S.trash.length}</h3><button class="x">×</button></div>
    <div class="mb">${S.trash.map(t => `<div class="dist"><span>${esc(projName(t))}</span><span class="hint">${esc(t.trashedAt || '')}</span>
      <span class="d"><button class="btn sm" data-rst="${t.id}">복원</button> <button class="btn sm dgr" data-prg="${t.id}">완전 삭제</button></span></div>`).join('') || '<p class="hint">비어 있습니다.</p>'}</div>
    <div class="mf"><button class="btn" onclick="closeModal()">닫기</button></div>`);
  $$('[data-rst]').forEach(b => b.onclick = async () => {
    await restoreProject(b.dataset.rst);
    closeModal(); renderTable(); renderSettings(); toast('복원했습니다 — 사진과 답사 기록도 함께 돌아옵니다');
  });
  $$('[data-prg]').forEach(b => b.onclick = async () => {
    const t = S.trash.find(x => x.id === b.dataset.prg);
    if (!await confirmBox('완전 삭제', `<p><b>${esc(projName(t || {}))}</b> 의 사진 원본과 답사 기록까지 영구히 삭제합니다. 되돌릴 수 없습니다.</p>`, '영구 삭제')) return;
    await purgeProject(b.dataset.prg);
    closeModal(); renderSettings(); toast('완전히 삭제했습니다');
  });
}
function dupModal(groups) {
  openModal(`<div class="mh"><h3>중복 의심 사진</h3><button class="x">×</button></div>
    <div class="mb"><p class="hint">해상도와 축소본이 거의 같은 사진들입니다. 남길 것을 확인하고 나머지를 삭제하세요.</p>
    ${groups.map((g, i) => `<div style="margin-top:12px"><div class="hint mono">그룹 ${i + 1} · ${g.length}장</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${g.map((p, j) => `<div style="text-align:center">
        <img src="${p.thumb}" style="width:92px;height:70px;object-fit:cover;border-radius:3px;border:1px solid var(--line)" alt="">
        <div><button class="btn sm ${j === 0 ? '' : 'dgr'}" data-dd="${p.id}" ${j === 0 ? 'disabled' : ''}>${j === 0 ? '유지' : '삭제'}</button></div></div>`).join('')}</div></div>`).join('')}</div>
    <div class="mf"><button class="btn" onclick="closeModal()">닫기</button></div>`, { wide: true });
  $$('[data-dd]').forEach(b => b.onclick = async () => {
    await S.store.del('photos', b.dataset.dd); await S.store.del('photofull', b.dataset.dd);
    b.closest('div').parentElement.style.opacity = .3; b.disabled = true; b.textContent = '삭제됨';
    toast('삭제했습니다');
  });
}

/* ---------- lightbox ---------- */
$('#lbclose').onclick = () => $('#lightbox').classList.remove('on');
$('#lightbox').addEventListener('mousedown', e => { if (e.target.id === 'lightbox') $('#lightbox').classList.remove('on'); });

boot();
