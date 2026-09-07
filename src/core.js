/* ============================================================
   시장아파트 답사 아카이브 — core
   ============================================================ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
/* 앱 코드 버전과 데이터 스키마 버전은 별개로 관리한다.
   - APP_VERSION : 화면·기능이 바뀔 때마다 올린다. 데이터에는 영향을 주지 않는다.
   - SCHEMA_VERSION : 저장 구조가 바뀔 때만 올린다. MIGRATIONS에 대응 항목이 있어야 한다. */
const APP_VERSION = '2.2.0';
const SCHEMA_VERSION = 3;

/* 영구 고유 ID. 한 번 부여되면 앱이 몇 번 배포되든 바뀌지 않는다. */
const uid = () => {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const today = () => new Date().toISOString().slice(0, 10);
const fmtKm = m => m == null ? '—' : (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km');
const bytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B';

/* 층 구성 표기. 지하는 지상 층수와 성격이 다르므로(주차·시장 하역·창고)
   합산하지 않고 «지하 2층 · 시장 2 + 주거 4층 · 지상 전체 6층» 처럼 따로 적는다. */
function floorText(p) {
  const parts = [];
  if (p.basementFloors) parts.push(`지하 ${p.basementFloors}층`);
  const up = [];
  if (p.marketFloors != null) up.push('시장 ' + p.marketFloors);
  if (p.aptFloors != null) up.push('주거 ' + p.aptFloors);
  if (up.length) parts.push(up.join(' + ') + '층');
  if (p.totalFloors != null) parts.push(`지상 전체 ${p.totalFloors}층`);
  return parts.join(' · ') || '—';
}
/** 표·쪽지에 들어가는 짧은 표기 — B2/2＋4 */
function floorShort(p) {
  const b = p.basementFloors ? 'B' + p.basementFloors + '/' : '';
  if (p.marketFloors == null && p.aptFloors == null) return b ? b.slice(0, -1) : '—';
  return b + `${p.marketFloors == null ? '?' : p.marketFloors}＋${p.aptFloors == null ? '?' : p.aptFloors}`;
}

function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms || 2600);
}
function haversine(a, b, c, d) {
  if ([a, b, c, d].some(v => v == null)) return null;
  const R = 6371000, r = Math.PI / 180;
  const dLat = (c - a) * r, dLon = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- modal ---------- */
function openModal(html, opts) {
  const o = opts || {};
  $('#modalbox').className = 'modal' + (o.wide ? ' wide' : '');
  $('#modalbox').innerHTML = html;
  $('#modal').classList.add('on');
  const x = $('#modalbox .x'); if (x) x.onclick = closeModal;
  return $('#modalbox');
}
function closeModal() { $('#modal').classList.remove('on'); $('#modalbox').innerHTML = ''; }
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); $('#lightbox').classList.remove('on'); if (MAP.picking) MAP.setPick(false); if (MAP.drawing) MAP.cancelLine(); }
});
function confirmBox(title, body, okLabel) {
  return new Promise(res => {
    const m = openModal(`<div class="mh"><h3>${esc(title)}</h3><button class="x">×</button></div>
      <div class="mb">${body}</div>
      <div class="mf"><button class="btn" data-no>취소</button><button class="btn dgr" data-yes>${esc(okLabel || '삭제')}</button></div>`);
    m.querySelector('[data-no]').onclick = () => { closeModal(); res(false); };
    m.querySelector('[data-yes]').onclick = () => { closeModal(); res(true); };
  });
}

/* ---------- storage backends ---------- */
const IDB = {
  name: 'idb', label: '이 브라우저에 저장 (로컬)', db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('mktapt-archive', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async _tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', mode), st = tx.objectStore('kv');
      const holder = {};
      try { fn(st, holder); } catch (e) { rej(e); return; }
      tx.oncomplete = () => res(holder.value);
      tx.onerror = () => rej(tx.error);
    });
  },
  async list(coll, filter) {
    const rows = await this._tx('readonly', (st, h) => {
      h.value = [];
      const req = st.openCursor(IDBKeyRange.bound(coll + '::', coll + '::￿'));
      req.onsuccess = e => {
        const c = e.target.result; if (!c) return;
        h.value.push(Object.assign({ id: String(c.key).slice(coll.length + 2) }, c.value));
        c.continue();
      };
    });
    return filter ? rows.filter(r => r[filter[0]] === filter[2]) : rows;
  },
  async get(coll, id) {
    const v = await this._tx('readonly', (st, h) => { const rq = st.get(coll + '::' + id); rq.onsuccess = () => h.value = rq.result; });
    return v ? Object.assign({ id }, v) : null;
  },
  async put(coll, id, data) { const d = Object.assign({}, data); delete d.id; await this._tx('readwrite', st => st.put(d, coll + '::' + id)); },
  async del(coll, id) { await this._tx('readwrite', st => st.delete(coll + '::' + id)); }
};

function makeDbBackend(db) {
  return {
    name: 'db', label: 'Claude 계정에 저장 (기기 간 동기화)', raw: db,
    async list(coll, filter) {
      let q = db.collection(coll);
      if (filter) q = q.where(filter[0], filter[1], filter[2]);
      const s = await q.get();
      return s.docs.map(d => Object.assign({ id: d.id }, d.data()));
    },
    async get(coll, id) { const s = await db.doc(coll + '/' + id).get(); return s.exists ? Object.assign({ id }, s.data()) : null; },
    async put(coll, id, data) { const d = Object.assign({}, data); delete d.id; await db.doc(coll + '/' + id).set(d); },
    async del(coll, id) { await db.doc(coll + '/' + id).delete(); }
  };
}

/* ---------- app state ---------- */
const S = {
  store: null, projects: [], facilities: [], fields: [], trash: [],
  sel: new Set(), view: 'map', cur: null, photos: [], notes: [],
  sort: { k: 'surveyDate', dir: 'desc' }, filter: {}, filterMore: false, q: '',
  sample: null, downloads: null, meta: null, schemaAhead: false
};

const BASE_FIELDS = [
  { k: 'name', label: '프로젝트명', type: 'text', core: 1 },
  { k: 'marketName', label: '시장명', type: 'text', core: 1 },
  { k: 'aptName', label: '시장아파트명', type: 'text', core: 1 },
  { k: 'sido', label: '시·도', type: 'text', core: 1 },
  { k: 'sgg', label: '시·군·구', type: 'text', core: 1 },
  { k: 'address', label: '상세 주소', type: 'text', core: 1 },
  { k: 'lat', label: '위도', type: 'number', core: 1 },
  { k: 'lng', label: '경도', type: 'number', core: 1 },
  { k: 'surveyDate', label: '답사일', type: 'date', core: 1 },
  { k: 'builtYear', label: '건축연도', type: 'number', core: 1 },
  { k: 'remodel', label: '리모델링·증축', type: 'select', options: ['미확인', '없음', '리모델링', '증축', '리모델링+증축'], core: 1 },
  { k: 'marketFloors', label: '시장 층수', type: 'number', core: 1 },
  { k: 'aptFloors', label: '아파트 층수', type: 'number', core: 1 },
  { k: 'basementFloors', label: '지하 층수', type: 'number', core: 1 },
  { k: 'totalFloors', label: '지상 전체 층수', type: 'number', core: 1 },
  { k: 'parking', label: '주차장', type: 'bool', core: 1 },
  { k: 'parkingType', label: '주차장 위치·형태', type: 'text', core: 1 },
  { k: 'relation', label: '시장–주거 관계', type: 'select', options: ['미분류', '시장 상부 주거(수직)', '시장 인접 주거(수평)', '별동 주거', '중정형', '가로형', '블록형', '복합형'], core: 1 },
  { k: 'nearStation', label: '인접 철도역', type: 'text', core: 1 },
  { k: 'nearTerminal', label: '인접 버스터미널', type: 'text', core: 1 },
  { k: 'transit', label: '주변 주요 교통시설', type: 'text', core: 1 },
  { k: 'status', label: '현재 상태', type: 'select', options: ['미확인', '활성', '부분 공실', '다수 공실', '폐쇄·철거예정', '철거됨'], core: 1 },
  { k: 'tags', label: '태그', type: 'tags', core: 1 },
  { k: 'note', label: '비고', type: 'long', core: 1 }
];
const FAC_KINDS = {
  apt: { label: '시장아파트', color: 'var(--signal)', shape: 'sq' },
  station: { label: '현재 기차역', color: 'var(--accent)', shape: 'ci' },
  oldstation: { label: '과거 기차역 (1970–80s)', color: 'var(--accent)', shape: 'ci-o' },
  rail: { label: '현재 철도 노선', color: 'var(--accent)', shape: 'ln' },
  oldrail: { label: '과거 철도 노선', color: 'var(--accent)', shape: 'ln-d' },
  terminal: { label: '버스터미널', color: 'var(--ok)', shape: 'tri' },
  market: { label: '시장', color: 'var(--violet)', shape: 'dia' }
};
const PHOTO_CATS = ['건물 전체', '시장 외부', '입면', '골목·주변', '시장 내부', '아파트 공용부', '계단', '복도', '주차장', '간판·디테일', '기타'];
const SIDO_OF = c => ({ '11': '서울특별시', '21': '부산광역시', '22': '대구광역시', '23': '인천광역시', '24': '광주광역시', '25': '대전광역시', '26': '울산광역시', '29': '세종특별자치시', '31': '경기도', '32': '강원도', '33': '충청북도', '34': '충청남도', '35': '전라북도', '36': '전라남도', '37': '경상북도', '38': '경상남도', '39': '제주특별자치도' }[String(c).slice(0, 2)] || '');

const NAV = [
  { v: 'map', i: 'i-map', t: '지도' },
  { v: 'list', i: 'i-list', t: '프로젝트' },
  { v: 'elev', i: 'i-elev', t: '입면' },
  { v: 'ana', i: 'i-ana', t: '분석' },
  { v: 'out', i: 'i-out', t: '출력' },
  { v: 'set', i: 'i-set', t: '설정' }
];
function ico(id, cls) { return `<svg class="ic ${cls || ''}" viewBox="0 0 20 20"><use href="#${id}"/></svg>`; }
function buildNav() {
  $('#nav').innerHTML = NAV.map(n => `<button class="navbtn" data-go="${n.v}" aria-current="${n.v === S.view}">${ico(n.i)}<span>${n.t}</span><span class="cnt" data-cnt="${n.v}"></span></button>`).join('');
  $('#tabbar').innerHTML = NAV.map(n => `<button class="tb" data-go="${n.v}" aria-current="${n.v === S.view}">${ico(n.i)}<span>${n.t}</span></button>`).join('');
  $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
}
function go(v) {
  S.view = v;
  $$('.view').forEach(s => s.classList.toggle('on', s.dataset.view === v || (v === 'detail' && s.dataset.view === 'detail')));
  $$('[data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === v || (v === 'detail' && b.dataset.go === 'list')));
  if (v === 'map') MAP.resize();
  if (v === 'list') renderTable();
  if (v === 'ana') renderAnalysis();
  if (v === 'out') renderOutput();
  if (v === 'set') renderSettings();
  if (v === 'elev') renderElevPicker();
}
function updateCounts() {
  // 첫 안내는 데이터가 하나라도 생기면 사라진다 (프로젝트든 참조 지점이든)
  if (S.projects.length || S.facilities.length) { const h = $('#firsthint'); if (h) h.remove(); }
  const c = { map: '', list: S.projects.length, elev: '', ana: '', out: S.sel.size || '', set: '' };
  $$('[data-cnt]').forEach(e => e.textContent = c[e.dataset.cnt] || '');
  $('#mapstat').textContent = `프로젝트 ${S.projects.length} · 참조지점 ${S.facilities.length}`;
}

/* ---------- theme ---------- */
(function theme() {
  let t = null; try { t = localStorage.getItem('mkt-theme'); } catch (e) { }
  if (t) document.documentElement.setAttribute('data-theme', t);
  $('#themebtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const isDark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    const nx = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nx);
    try { localStorage.setItem('mkt-theme', nx); } catch (e) { }
    MAP.draw();
  };
})();

/* ============================================================
   데이터 보존 규칙 (이 앱의 가장 중요한 원칙)
   1) 코드와 데이터는 완전히 분리된다. 앱을 다시 배포해도 저장소는 그대로 남는다.
   2) 프로젝트·사진·기록은 영구 고유 ID로 식별한다. ID는 절대 재발급하지 않는다.
   3) 저장은 항상 "불러온 문서 전체를 되쓰는" 방식이라, 이 버전이 모르는 필드도
      지워지지 않고 그대로 보존된다.
   4) 스키마가 바뀌면 MIGRATIONS에 항목을 추가한다. 마이그레이션은 값을 채우기만 하고
      기존 값을 지우거나 덮어쓰지 않는다. 실행 전 프로젝트 스냅샷을 남긴다.
   ============================================================ */
const MIGRATIONS = [
  {
    v: 1, name: '기준선 — 필수 필드 채우기',
    async run(store, ctx) {
      let n = 0;
      for (const p of ctx.projects) {
        const patch = {};
        if (!p.createdAt) patch.createdAt = p.updatedAt || new Date().toISOString();
        if (!p.custom) patch.custom = {};
        if (!Array.isArray(p.tags)) patch.tags = [];
        if (Object.keys(patch).length) { Object.assign(p, patch); await store.put('projects', p.id, stripId(p)); n++; }
      }
      return n;
    }
  },
  {
    v: 2, name: '사진·기록에 소속 프로젝트 ID 확정',
    async run(store, ctx) {
      // pid 가 없는 오래된 사진/기록이 있으면 고아가 되지 않도록 표시만 남긴다(삭제하지 않음).
      let n = 0;
      for (const coll of ['photos', 'notes']) {
        const rows = await store.list(coll);
        for (const r of rows) {
          if (!r.pid && !r.orphan) { r.orphan = true; await store.put(coll, r.id, stripId(r)); n++; }
        }
      }
      return n;
    }
  },
  {
    v: 3, name: '사진 묶어 담기 — 기존 사진은 그대로 둔다',
    async run() {
      /* 이 버전부터 새 사진은 photobook 묶음에 들어간다. 예전 photos/{id} 문서도
         그대로 읽히므로 여기서는 아무것도 옮기지 않는다.
         실제로 옮기는 것은 설정 → 저장 공간의 «묶어 담기»를 눌렀을 때만,
         백업을 먼저 받고 옮긴 결과를 확인한 뒤에 일어난다. */
      return 0;
    }
  }
];
function stripId(o) { const d = Object.assign({}, o); delete d.id; return d; }

async function readMeta() {
  const m = await S.store.get('meta', 'app');
  return m || { schemaVersion: 0, appVersion: null, firstRunAt: null, migrations: [] };
}
async function runMigrations() {
  const meta = await readMeta();
  S.meta = meta;
  const fresh = !S.projects.length && !meta.firstRunAt;
  if (meta.schemaVersion > SCHEMA_VERSION) {
    S.schemaAhead = true;
    console.warn('저장된 데이터가 이 앱 버전보다 최신입니다. 마이그레이션을 건너뜁니다.');
    return;
  }
  const pending = MIGRATIONS.filter(m => m.v > (meta.schemaVersion || 0));
  if (pending.length && !fresh) await snapshotProjects(meta.schemaVersion || 0);
  const log = (meta.migrations || []).slice();
  for (const m of pending) {
    let changed = 0, error = null;
    try { changed = await m.run(S.store, { projects: S.projects }) || 0; }
    catch (e) { error = String(e && e.message || e); console.error('migration failed', m.v, e); }
    log.push({ v: m.v, name: m.name, at: new Date().toISOString(), changed, error });
    if (error) break;
  }
  const applied = log.filter(l => !l.error).map(l => l.v);
  const newVersion = applied.length ? Math.max(meta.schemaVersion || 0, ...applied) : (meta.schemaVersion || 0);
  S.meta = {
    schemaVersion: newVersion,
    appVersion: APP_VERSION,
    firstRunAt: meta.firstRunAt || new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
    migrations: log.slice(-20)
  };
  await S.store.put('meta', 'app', S.meta);
  if (pending.length && !fresh) toast(`데이터 구조를 v${newVersion}로 갱신했습니다 (기존 기록 유지)`, 3600);
}
/** 마이그레이션 직전 프로젝트 문서의 안전 스냅샷 (사진 원본은 건드리지 않는다) */
async function snapshotProjects(fromVersion) {
  try {
    const payload = JSON.stringify({ at: new Date().toISOString(), fromVersion, projects: S.projects, fields: S.fields, facilities: S.facilities });
    if (payload.length > 200000) return; // 문서 한도(256KB)를 넘으면 건너뛴다
    await S.store.put('snapshots', 'premigrate_v' + fromVersion, { at: new Date().toISOString(), fromVersion, payload });
  } catch (e) { console.warn('snapshot skipped', e); }
}

/* ---------- 저장 재시도 ----------
   사진 한 장이 문서 두 개(메타+원본)를 쓴다. 48장이면 96번을 몰아서 쓰게 되는데,
   계정 저장소는 순간적으로 몰리면 쓰기를 거절하기도 한다. 한 번 실패했다고 그 사진을
   버리면 답사 기록이 조용히 새어 나가므로, 잠깐 쉬었다가 다시 시도한다.
   문서가 한도보다 크거나 저장 공간이 찬 경우는 다시 해도 같으므로 바로 알린다. */
/* 다시 해 볼 가치가 있는 실패와 그렇지 않은 실패를 가른다.
   "rate limit exceeded" 처럼 두 낱말이 겹치는 문구가 흔하므로 재시도 쪽을 먼저 본다.
   어느 쪽도 아닌 처음 보는 오류는 일단 다시 시도한다 — 한 번 더 해 보는 값이
   답사 사진 한 장을 잃는 값보다 싸다. */
/* 앞쪽은 저장소가 실제로 내는 코드 이름(계약서의 StoreErrorCode), 뒤쪽은
   IndexedDB 처럼 코드 대신 문장을 주는 경우를 위한 낱말 규칙이다. */
const RETRY_PUT = /resource_exhausted|unavailable|rate|429|too many|timeout|timed ?out|network|busy|temporar|try again|conflict|abort|failed to fetch|internal|502|503|504/i;
const FATAL_PUT = /invalid_argument|quota_exceeded|revoked|not_granted|capability_(disabled|removed)|transform_error|too large|payload|document size|quota|storage full|invalid|permission|denied|not.?allowed|unauthor|forbidden|401|403/i;
async function putRetry(coll, id, data, tries) {
  let last = null;
  const n = tries || 4;
  for (let i = 0; i < n; i++) {
    try { await S.store.put(coll, id, data); return; }
    catch (e) {
      last = e;
      const msg = String((e && (e.message || e.code)) || e);
      if (!RETRY_PUT.test(msg) && FATAL_PUT.test(msg)) throw e;
      if (i < n - 1) await new Promise(r => setTimeout(r, 250 * Math.pow(2, i) + Math.random() * 200));
    }
  }
  throw last;
}

/* ============================================================
   사진 저장소 — 묶어 담기

   문서 하나는 256KiB 까지고 아티팩트 하나가 문서를 5,000개까지 담는다.
   원본(150–220KB)은 어차피 문서 하나를 채우므로 줄일 수 없지만,
   썸네일(약 11KB)과 메타(약 300B)는 문서 하나에 20장 넘게 들어간다.
   한 장에 문서 하나씩 쓰던 것을 프로젝트 단위로 묶으면
   사진 1장당 문서가 2개 → 약 1.05개가 되어 담을 수 있는 장수가 두 배 가까이 는다.

     photofull/{photoId}   원본 (그대로, 1장 = 문서 1개)
     photobook/{pid}__{n}  { pid, n, items: { photoId: 메타+썸네일 } }

   예전에 한 장씩 저장한 photos/{id} 문서도 그대로 읽는다. 두 가지가 섞여 있어도
   되고, 옮기는 것은 설정에서 사용자가 직접 «정리»를 눌렀을 때만 일어난다.
   ============================================================ */
/* 문서 한도는 256 KiB = 262,144 **바이트**다. 한글 메모는 글자당 3바이트라
   글자 수로 재면 어긋나므로 직렬화한 바이트를 직접 센다. 여유 17KB 를 남긴다. */
const BOOK_MAX = 245000;
const ENC = new TextEncoder();
const jsonBytes = o => ENC.encode(JSON.stringify(o)).length;
const PhotoStore = {
  /** 한 프로젝트의 사진 — 묶음과 옛 문서를 합쳐 돌려준다 */
  async list(pid) {
    const [books, legacy] = await Promise.all([
      S.store.list('photobook', ['pid', '==', pid]),
      S.store.list('photos', ['pid', '==', pid])
    ]);
    return this._merge(books, legacy);
  },
  /** 저장된 사진 전부 (설정·백업·무결성 점검) */
  async listAll() {
    const [books, legacy] = await Promise.all([S.store.list('photobook'), S.store.list('photos')]);
    return this._merge(books, legacy);
  },
  _merge(books, legacy) {
    const out = [];
    for (const b of books) {
      for (const [id, m] of Object.entries(b.items || {})) {
        out.push(Object.assign({ id }, m, { _book: b.id }));
      }
    }
    for (const l of legacy) out.push(Object.assign({}, l, { _book: null }));
    return out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  },
  async get(id) {
    const all = await this.listAll();
    return all.find(p => p.id === id) || null;
  },
  /** 사진 메타를 넣는다. 한 장이 문서 하나를 쓴다.

      v1.8.0 에서 한 프로젝트의 사진 메타를 문서 하나에 «묶어 담아» 용량을 늘렸는데,
      그것이 데이터를 잃게 만들었다. 묶음에 한 장을 더하려면 문서를 읽고 고쳐서 통째로
      되써야 하는데, 이 저장소는 last-writer-wins 이고 방금 쓴 것이 곧바로 읽힌다는
      보장이 없다. 연달아 올리면 두 번째 사진이 «첫 사진이 없는» 묶음을 읽어 자기만
      담아 되쓰고, 앞의 메타가 지워졌다. 사진 90장을 올려도 마지막 한 장만 남는다.

      용량보다 데이터가 먼저다. 한 장에 문서 하나씩 쓰는 방식으로 되돌린다.
      담을 수 있는 장수는 약 2,500장으로 줄지만, 공유 문서를 고쳐 쓰지 않으므로
      이런 경합이 원천적으로 생기지 않는다. */
  async add(pid, id, meta) {
    await putRetry('photos', id, Object.assign({}, stripMeta(meta), { pid }));
    return null;
  },
  /** 여러 장의 메타를 고친다. 같은 묶음에 든 것은 한 번에 쓴다 — 20장 일괄 수정이 쓰기 1번이 된다. */
  async update(photos) {
    const byBook = new Map();
    for (const ph of photos) {
      const key = ph._book || ('@legacy:' + ph.id);
      if (!byBook.has(key)) byBook.set(key, []);
      byBook.get(key).push(ph);
    }
    for (const [key, list] of byBook) {
      if (key.slice(0, 8) === '@legacy:') {
        for (const ph of list) await putRetry('photos', ph.id, stripMeta(ph));
        continue;
      }
      const b = await S.store.get('photobook', key);
      if (!b) { for (const ph of list) await putRetry('photos', ph.id, stripMeta(ph)); continue; }
      const overflow = [];
      for (const ph of list) {
        const prev = b.items[ph.id];
        b.items[ph.id] = stripMeta(ph);
        // 메모가 길어져 묶음이 한도를 넘으면 그 사진만 다른 묶음으로 옮긴다
        if (jsonBytes(b.items) > BOOK_MAX) {
          if (prev) b.items[ph.id] = prev; else delete b.items[ph.id];
          overflow.push(ph);
        }
      }
      await putRetry('photobook', key, { pid: b.pid, n: b.n, items: b.items });
      for (const ph of overflow) {
        await this.remove([ph], true);
        await this.add(ph.pid, ph.id, ph);
      }
    }
  },
  /** 사진을 지운다 (메타·원본 모두). 같은 묶음은 한 번에 처리한다. */
  /** 사진을 지운다. 한 장이 실패해도 나머지는 계속 지우고, 무엇이 왜 안 됐는지 돌려준다.
   *  {removed, failed:[{id, why}]} */
  async remove(photos, keepFull) {
    const byBook = new Map();
    for (const ph of photos) {
      const key = ph._book || ('@legacy:' + ph.id);
      if (!byBook.has(key)) byBook.set(key, []);
      byBook.get(key).push(ph);
    }
    let removed = 0; const failed = [];
    for (const [key, list] of byBook) {
      const gone = [];                                   // 메타를 확실히 지운 것만 원본을 지운다
      if (key.slice(0, 8) === '@legacy:') {
        for (const ph of list) {
          try { await delRetry('photos', ph.id); gone.push(ph); }
          catch (e) { failed.push({ id: ph.id, why: String((e && (e.message || e.code)) || e) }); }
        }
      } else {
        let b = null;
        try { b = await S.store.get('photobook', key); } catch (e) { }
        // 묶음을 못 찾으면 조용히 넘기지 않는다 — 다른 묶음에 들어 있을 수 있으니 찾아본다
        if (!b) {
          const ids = new Set(list.map(ph => ph.id));
          try {
            const all = await S.store.list('photobook', list[0].pid ? ['pid', '==', list[0].pid] : null);
            b = all.find(x => Object.keys(x.items || {}).some(i => ids.has(i))) || null;
          } catch (e) { }
        }
        if (!b) {
          for (const ph of list) failed.push({ id: ph.id, why: '사진이 담긴 묶음을 찾지 못했습니다' });
          continue;
        }
        for (const ph of list) delete b.items[ph.id];
        try {
          if (Object.keys(b.items).length) await putRetry('photobook', b.id, { pid: b.pid, n: b.n, items: b.items });
          else await delRetry('photobook', b.id);
          gone.push(...list);
        } catch (e) {
          const why = String((e && (e.message || e.code)) || e);
          for (const ph of list) failed.push({ id: ph.id, why });
        }
      }
      removed += gone.length;
      if (!keepFull) for (const ph of gone) { try { await delRetry('photofull', ph.id); } catch (e) { console.warn('원본 삭제 실패', ph.id, e); } }
    }
    return { removed, failed };
  }
};
/** 문서에 쓰기 전에 화면용 표시 필드를 걷어낸다 */
function stripMeta(o) {
  const d = Object.assign({}, o);
  delete d.id; delete d._book;
  return d;
}

/* ---------- 백업 챙기기 ----------
   저장소가 아무리 튼튼해도 백업 없는 아카이브는 하루아침에 사라질 수 있다.
   답사 사진은 다시 찍을 수 없으므로, 마지막 백업 이후 사진이 많이 쌓이거나
   시간이 오래 지나면 조용히 알려 준다. */
const BACKUP_DAYS = 14, BACKUP_PHOTOS = 40;
async function touchMeta(patch) {
  S.meta = Object.assign({}, S.meta || {}, patch);
  try { await putRetry('meta', 'app', S.meta); } catch (e) { console.warn('meta 저장 실패', e); }
}
function backupAge() {
  const at = S.meta && S.meta.lastBackupAt;
  if (!at) return null;
  return Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
}
function backupDue() {
  const total = S.projects.reduce((a, p) => a + (p.photoCount || 0), 0);
  if (!total) return null;
  const since = total - ((S.meta && S.meta.photosAtBackup) || 0);
  const age = backupAge();
  if (age == null) return { why: '아직 백업을 한 번도 받지 않았습니다', total, since };
  if (since >= BACKUP_PHOTOS) return { why: `마지막 백업 뒤 사진 ${since}장이 늘었습니다`, total, since, age };
  if (age >= BACKUP_DAYS) return { why: `마지막 백업이 ${age}일 전입니다`, total, since, age };
  return null;
}
/** 사진을 많이 올린 뒤 한 번 권한다 (귀찮게 하지 않도록 조건을 넉넉히 둔다) */
function maybeSuggestBackup(justAdded) {
  const due = backupDue();
  if (!due || justAdded < 10) return;
  toast(`${due.why} — 설정에서 백업을 받아 두세요`, 5200);
}

/* ---------- 저장 용량 ----------
   아티팩트 하나의 데이터베이스는 문서를 최대 5,000개까지 담고, 문서 하나는 256KiB 까지다.
   사진 한 장이 문서 두 개(메타+원본)를 쓰므로 사진 장수가 사실상 이 한도를 정한다. */
const DOC_CAP = 5000;
async function storageUsage() {
  const [books, legacy, notes] = await Promise.all([
    S.store.list('photobook'), S.store.list('photos'), S.store.list('notes')]);
  const packed = books.reduce((a, b) => a + Object.keys(b.items || {}).length, 0);
  const photos = packed + legacy.length;
  // 원본은 장당 문서 1개, 묶음은 실제 문서 수, 옛 사진은 장당 메타 1개
  const docs = photos + books.length + legacy.length + notes.length
    + S.projects.length + S.trash.length + S.facilities.length + S.fields.length + 2;
  // 사진 한 장 = 문서 2개 (메타 + 원본)
  const perPhoto = 2;
  const all = books.flatMap(b => Object.values(b.items || {})).concat(legacy);
  return {
    photos, packed, legacy: legacy.length, notes: notes.length, docs, cap: DOC_CAP,
    perPhoto: +perPhoto.toFixed(2), books: books.length,
    left: Math.max(0, DOC_CAP - docs),
    photosLeft: Math.max(0, Math.floor((DOC_CAP - docs) / perPhoto)),
    reclaim: 0,
    bytes: all.reduce((a, p) => a + (p.size || 0) + (p.thumb ? p.thumb.length : 0), 0)
  };
}

/** 지우기도 쓰기와 같은 호출 한도를 쓴다. 사진 20장을 한 번에 지우면 40번 넘게
    부르게 되어 저장소가 거절할 수 있다. 쓰기만 재시도하고 지우기는 그냥 두면
    «지워지지 않는» 것처럼 보인다. */
async function delRetry(coll, id, tries) {
  let last = null;
  const n = tries || 4;
  for (let i = 0; i < n; i++) {
    try { await S.store.del(coll, id); return; }
    catch (e) {
      last = e;
      const msg = String((e && (e.message || e.code)) || e);
      if (!RETRY_PUT.test(msg) && FATAL_PUT.test(msg)) throw e;
      if (i < n - 1) await new Promise(r => setTimeout(r, 250 * Math.pow(2, i) + Math.random() * 200));
    }
  }
  throw last;
}

/* ---------- 진행 표시 ----------
   사진 수십 장은 시간이 걸린다. 아무 표시가 없으면 멈춘 것으로 오해해
   창을 닫아 버리게 되므로, 몇 장째인지 계속 보여준다. */
function progressStart(total, label) {
  const el = $('#progress');
  el.classList.add('on');
  el.innerHTML = `<div class="pt"><b id="pgLbl">${esc(label || '처리 중')}</b><span class="mono" id="pgN">0 / ${total}</span></div>
    <div class="pbar"><i id="pgBar" style="width:0%"></i></div><div class="hint" id="pgSub"></div>`;
  return {
    set(i, sub) {
      $('#pgN').textContent = `${i} / ${total}`;
      $('#pgBar').style.width = (total ? i / total * 100 : 0).toFixed(1) + '%';
      if (sub != null) $('#pgSub').textContent = sub;
    },
    done() { el.classList.remove('on'); el.innerHTML = ''; }
  };
}

/* ---------- data ops ---------- */
async function loadAll() {
  const [p, f, fl, tr] = await Promise.all([
    S.store.list('projects'), S.store.list('facilities'), S.store.list('fields'), S.store.list('trash')
  ]);
  S.projects = p.filter(x => !x.deleted);
  S.facilities = f;
  S.fields = fl.sort((a, b) => (a.order || 0) - (b.order || 0));
  S.trash = tr;
}
async function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  if (!p.createdAt) p.createdAt = p.updatedAt;
  await putRetry('projects', p.id, p);
  const i = S.projects.findIndex(x => x.id === p.id);
  if (i < 0) S.projects.push(p); else S.projects[i] = p;
  updateCounts(); MAP.draw();
}
/** 프로젝트를 휴지통으로 옮긴다. 사진·기록은 지우지 않고 같은 프로젝트 ID 아래 그대로 둔다.
 *  → 복원하면 사진과 답사 기록이 그대로 되살아난다. */
async function deleteProject(id) {
  const p = S.projects.find(x => x.id === id); if (!p) return;
  const rec = Object.assign({}, p, { trashedAt: new Date().toISOString() });
  await S.store.put('trash', id, stripId(rec));
  await S.store.del('projects', id);
  S.trash.push(rec);
  S.projects = S.projects.filter(x => x.id !== id); S.sel.delete(id);
  updateCounts(); MAP.draw();
}
/** 휴지통에서 완전 삭제. 이때만 사진 원본과 기록이 실제로 지워진다. */
async function purgeProject(id) {
  await PhotoStore.remove(await PhotoStore.list(id));
  const nt = await S.store.list('notes', ['pid', '==', id]);
  for (const x of nt) await delRetry('notes', x.id);
  await delRetry('trash', id);
  S.trash = S.trash.filter(x => x.id !== id);
  updateCounts();
}
async function restoreProject(id) {
  const t = S.trash.find(x => x.id === id); if (!t) return;
  const p = Object.assign({}, t); delete p.trashedAt;
  await saveProject(p);
  await S.store.del('trash', id);
  S.trash = S.trash.filter(x => x.id !== id);
}
function projName(p) { return p.name || p.aptName || p.marketName || '(이름 없음)'; }

/* ---------- boot ---------- */
async function boot() {
  buildNav();
  let backend = null;
  try {
    if (window.claude && claude.use) {
      const db = await claude.use('db');
      if (db) backend = makeDbBackend(db);
      claude.use('sample').then(s => { S.sample = s; if (S.view === 'ana') renderAnalysis(); }).catch(() => { });
      claude.use('downloads').then(d => { S.downloads = d; }).catch(() => { });
    }
  } catch (e) { console.warn('db unavailable', e); }
  if (!backend) { try { await IDB.open(); backend = IDB; } catch (e) { } }
  if (!backend) { $('#storelbl').textContent = '저장소 사용 불가'; toast('이 브라우저에서는 데이터를 저장할 수 없습니다'); return; }
  S.store = backend;
  $('#storelbl').textContent = backend.name === 'db' ? '동기화 저장소' : '로컬 저장소';
  $('#storelbl').title = backend.label;
  try { await loadAll(); } catch (e) { console.error(e); toast('데이터를 불러오지 못했습니다'); }
  try { await runMigrations(); } catch (e) { console.error('migration', e); toast('데이터 구조 갱신 중 문제가 있었습니다 — 기존 기록은 그대로입니다', 4200); }
  MAP.init();
  updateCounts();
  renderTable();
  if (!S.projects.length && !S.facilities.length) firstRunHint();
}
function firstRunHint() {
  const el = document.createElement('div');
  el.className = 'panel'; el.id = 'firsthint';
  el.style.cssText = 'position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);z-index:4;max-width:340px;padding:16px 18px;text-align:center';
  el.innerHTML = `<h3 style="font-family:var(--f-disp);font-size:17px;margin-bottom:6px">첫 답사를 기록해 보세요</h3>
    <p class="hint" style="margin:0 0 12px">지도에서 위치를 지정하면 시·도와 시·군·구가 자동으로 채워집니다. 사진과 답사 기록은 프로젝트 안에 쌓입니다.</p>
    <div style="display:flex;gap:8px;justify-content:center"><button class="btn pri" id="fr1">＋ 새 프로젝트</button><button class="btn" id="fr2">닫기</button></div>`;
  $('#mapwrap').appendChild(el);
  el.querySelector('#fr1').onclick = () => { el.remove(); newProject(); };
  el.querySelector('#fr2').onclick = () => el.remove();
}
