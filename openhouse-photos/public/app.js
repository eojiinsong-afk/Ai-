import { $, esc, api, toast, fmtDate, photoTile, lightbox } from '/common.js';

const app = $('#app');
let me = null;
let joinCodeRequired = false;

const mediaSrc = (ph, kind) => `/media/${ph.id}/${kind}`;
const isAdmin = () => me?.role === 'admin';
const shareUrl = (t) => `${location.origin}/s/${t}`;

// ───────────── 부팅 · 라우팅 ─────────────
async function boot() {
  const r = await api('/api/me');
  me = r.user; joinCodeRequired = r.join_code_required;
  $('#top').hidden = !me;
  if (!me) return renderAuth();
  $('#who').innerHTML = `${esc(me.name)}${isAdmin() ? '<span class="badge">관리자</span>' : ''}`;
  $('#usersLink').hidden = !isAdmin();
  route();
}
window.addEventListener('hashchange', () => me && route());
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.hash = ''; boot(); };

function route() {
  const h = location.hash.slice(1) || '/';
  let m;
  window.scrollTo(0, 0);
  if ((m = h.match(/^\/p\/(\d+)$/))) return renderProject(Number(m[1]));
  if (h === '/users' && isAdmin()) return renderUsers();
  return renderProjects();
}

const guard = (fn) => async (...a) => {
  try { await fn(...a); } catch (e) {
    if (e.status === 401) { me = null; return boot(); }
    toast(e.message);
  }
};

// ───────────── 로그인 · 가입 ─────────────
function renderAuth() {
  app.innerHTML = `
    <div class="auth">
      <h1>오픈하우스 사진함</h1>
      <p class="lead">투어에서 찍은 사진을 모아 건축가께 전해드립니다.</p>
      <div class="card">
        <div class="tabs" role="tablist">
          <button role="tab" data-mode="login" aria-selected="true">로그인</button>
          <button role="tab" data-mode="register" aria-selected="false">처음이에요</button>
          <button role="tab" data-mode="admin" aria-selected="false">관리자</button>
        </div>
        <form id="authForm" novalidate>
          <div class="field" data-for="login register"><label for="a-name">이름 (사진에 표시될 이름)</label>
            <input id="a-name" name="name" autocomplete="username" maxlength="30"></div>
          <div class="field"><label for="a-pw" id="a-pw-label">비밀번호</label>
            <input id="a-pw" name="password" type="password" autocomplete="current-password"></div>
          <div class="field" data-for="register" ${joinCodeRequired ? '' : 'data-off'}><label for="a-code">참가 코드 (현장에서 안내)</label>
            <input id="a-code" name="join_code" autocomplete="off"></div>
          <p class="err" id="a-err"></p>
          <button class="btn primary" id="a-submit">로그인</button>
        </form>
        <p class="small muted" id="a-hint" style="margin:14px 0 0"></p>
      </div>
    </div>`;
  let mode = 'login';
  const form = $('#authForm');
  const apply = () => {
    for (const t of app.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', t.dataset.mode === mode);
    for (const f of form.querySelectorAll('[data-for]')) f.hidden = !f.dataset.for.split(' ').includes(mode) || f.hasAttribute('data-off');
    $('#a-pw-label').textContent = mode === 'admin' ? '관리자 비밀번호' : mode === 'register' ? '비밀번호 (4자 이상)' : '비밀번호';
    $('#a-pw').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#a-submit').textContent = { login: '로그인', register: '가입하고 시작하기', admin: '관리자 로그인' }[mode];
    $('#a-hint').textContent = mode === 'register' ? '이름과 비밀번호만 있으면 됩니다. 내가 올린 사진은 언제든 내가 지울 수 있어요.' : '';
    $('#a-err').textContent = '';
  };
  app.querySelectorAll('[role=tab]').forEach((t) => (t.onclick = () => { mode = t.dataset.mode; apply(); }));
  apply();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const btn = $('#a-submit'); btn.disabled = true;
    try {
      const url = { login: '/api/login', register: '/api/register', admin: '/api/admin/login' }[mode];
      await api(url, { method: 'POST', body: fd });
      await boot();
    } catch (err) { $('#a-err').textContent = err.message; }
    finally { btn.disabled = false; }
  };
}

// ───────────── 프로젝트 목록 ─────────────
const renderProjects = guard(async () => {
  const { projects } = await api('/api/projects');
  app.innerHTML = `
    <div class="wrap">
      <div class="page-head">
        <div class="grow"><h1>건축물</h1><div class="meta">${projects.length}곳 · 사진을 올릴 건축물을 고르세요</div></div>
        ${isAdmin() ? '<div class="actions"><button class="btn primary" id="addProject">+ 건축물 추가</button></div>' : ''}
      </div>
      ${isAdmin() ? `<div class="share-note">각 건축물의 <b>소장님 링크</b>를 복사해 건축가께 보내세요. 링크를 받은 분은 로그인 없이 <b>그 건축물 사진만</b> 보고 내려받을 수 있습니다. 링크가 새어나갔다면 <b>재발급</b>하면 이전 링크는 바로 막힙니다.</div>` : ''}
      ${projects.length ? `<div class="grid-projects">${projects.map(projectCard).join('')}</div>`
        : `<div class="empty-state">${isAdmin() ? '아직 건축물이 없습니다. 오른쪽 위에서 추가하세요.' : '아직 등록된 건축물이 없습니다.'}</div>`}
    </div>`;
  $('#addProject')?.addEventListener('click', () => editProject(null));
  app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => projectAction(b.dataset.act, projects.find((p) => p.id === Number(b.dataset.id)))));
});

function projectCard(p) {
  const cover = p.cover_id ? `style="background-image:url('/media/${p.cover_id}/thumb')"` : '';
  return `
    <article class="pcard">
      <a class="cover" href="#/p/${p.id}" ${cover}>${p.cover_id ? '' : '<span class="empty">아직 사진이 없어요</span>'}</a>
      <div class="body">
        <h3><a href="#/p/${p.id}">${esc(p.name)}</a></h3>
        <div class="sub">${[p.architect, p.visit_date].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        <div class="sub">사진 ${p.photo_count}장</div>
      </div>
      ${isAdmin() ? `<div class="admin-row">
        <button class="btn sm" data-act="copy" data-id="${p.id}">소장님 링크 복사</button>
        <button class="btn sm ghost" data-act="edit" data-id="${p.id}">수정</button>
        <button class="btn sm ghost" data-act="rotate" data-id="${p.id}">링크 재발급</button>
        <button class="btn sm ghost danger" data-act="delete" data-id="${p.id}">삭제</button>
      </div>` : ''}
    </article>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('링크를 복사했습니다'); }
  catch { prompt('아래 링크를 복사하세요', text); }
}

const projectAction = guard(async (act, p) => {
  if (act === 'copy') return copyText(shareUrl(p.share_token));
  if (act === 'edit') return editProject(p);
  if (act === 'rotate') {
    if (!confirm(`'${p.name}'의 소장님 링크를 새로 만들까요?\n이전 링크는 더 이상 열리지 않습니다.`)) return;
    const r = await api(`/api/projects/${p.id}/rotate-link`, { method: 'POST' });
    await copyText(shareUrl(r.share_token));
    return route();
  }
  if (act === 'delete') {
    if (prompt(`'${p.name}'과 사진 ${p.photo_count}장을 모두 삭제합니다. 되돌릴 수 없습니다.\n확인하려면 건축물 이름을 입력하세요.`) !== p.name) return;
    await api(`/api/projects/${p.id}`, { method: 'DELETE' });
    toast('삭제했습니다');
    location.hash = '#/'; route();
  }
});

function editProject(p) {
  const dlg = $('#projectDialog'), form = $('#projectForm');
  $('#projectDialogTitle').textContent = p ? '건축물 수정' : '건축물 추가';
  form.name.value = p?.name || ''; form.architect.value = p?.architect || '';
  form.visit_date.value = p?.visit_date || ''; form.description.value = p?.description || '';
  $('#pf-err').textContent = '';
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      if (p) await api(`/api/projects/${p.id}`, { method: 'PATCH', body });
      else await api('/api/projects', { method: 'POST', body });
      dlg.close(); route();
    } catch (err) { $('#pf-err').textContent = err.message; }
  };
  dlg.showModal();
}

// ───────────── 프로젝트 상세 (사진) ─────────────
let filterMine = false;
const renderProject = guard(async (id) => {
  const { project: p, photos } = await api(`/api/projects/${id}`);
  const list = filterMine && !isAdmin() ? photos.filter((x) => x.mine) : photos;
  const myCount = photos.filter((x) => x.mine).length;
  app.innerHTML = `
    <div class="wrap">
      <a class="back" href="#/">← 전체 건축물</a>
      <div class="page-head">
        <div class="grow"><h1>${esc(p.name)}</h1>
          <div class="meta">${[p.architect, p.visit_date].filter(Boolean).map(esc).join(' · ')}${p.architect || p.visit_date ? ' · ' : ''}사진 ${photos.length}장</div></div>
        <div class="actions">
          ${photos.length ? `<a class="btn" href="/api/projects/${p.id}/download.zip">전체 다운로드</a>` : ''}
          ${isAdmin() ? `<button class="btn" id="copyShare">소장님 링크 복사</button>` : `<button class="btn primary" id="upload">+ 사진 올리기</button>`}
        </div>
      </div>
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
      ${!isAdmin() && photos.length ? `<div class="filters">
        <button class="chip" aria-pressed="${!filterMine}" data-f="all">전체 ${photos.length}</button>
        <button class="chip" aria-pressed="${filterMine}" data-f="mine">내 사진 ${myCount}</button></div>` : ''}
      ${list.length ? `<div class="grid-photos">${list.map((ph) => photoTile(ph, mediaSrc, { canDelete: true, showMine: !isAdmin() })).join('')}</div>`
        : `<div class="empty-state">${filterMine ? '아직 올린 사진이 없어요.' : '첫 사진을 올려주세요.'}</div>`}
    </div>`;

  $('#copyShare')?.addEventListener('click', () => copyText(shareUrl(p.share_token)));
  $('#upload')?.addEventListener('click', () => pickFiles(p.id));
  app.querySelectorAll('[data-f]').forEach((c) => (c.onclick = () => { filterMine = c.dataset.f === 'mine'; renderProject(id); }));
  app.querySelector('.grid-photos')?.addEventListener('click', guard(async (e) => {
    const tile = e.target.closest('.ph'); if (!tile) return;
    const idx = list.findIndex((x) => x.id === Number(tile.dataset.id));
    if (e.target.closest('.del')) {
      const ph = list[idx];
      const who = isAdmin() && ph.uploader ? ` (${ph.uploader}님 사진)` : '';
      if (!confirm(`이 사진을 삭제할까요?${who}`)) return;
      await api(`/api/photos/${ph.id}`, { method: 'DELETE' });
      toast('삭제했습니다');
      return renderProject(id);
    }
    if (e.target.closest('.open')) lightbox(list, idx, mediaSrc);
  }));
});

// ───────────── 업로드 ─────────────
function pickFiles(projectId) {
  const input = $('#fileInput');
  input.value = '';
  input.onchange = () => input.files.length && uploadFiles(projectId, [...input.files]);
  input.click();
}

// 썸네일은 브라우저에서 만든다 (서버에 이미지 라이브러리가 필요 없게). 실패하면 원본으로 대신 보여준다.
async function makeThumb(file, max = 720) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  } catch { return null; }
}

async function uploadFiles(projectId, files) {
  const box = document.createElement('div');
  box.className = 'progress'; box.setAttribute('role', 'status');
  box.innerHTML = '<div class="label"></div><div class="bar"><i></i></div>';
  document.body.append(box);
  const label = $('.label', box), bar = $('.bar i', box);
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    label.textContent = `사진 올리는 중 ${i + 1} / ${files.length}`;
    bar.style.width = `${(i / files.length) * 100}%`;
    try {
      const fd = new FormData();
      fd.append('file', f, f.name);
      const t = await makeThumb(f);
      if (t) fd.append('thumb', t, 'thumb.jpg');
      await api(`/api/projects/${projectId}/photos`, { method: 'POST', form: fd });
    } catch (e) {
      if (e.status === 401) { box.remove(); me = null; return boot(); }
      failed.push(`${f.name}: ${e.message}`);
    }
  }
  bar.style.width = '100%';
  box.remove();
  if (failed.length) alert(`${files.length - failed.length}장 올림, ${failed.length}장 실패\n\n${failed.join('\n')}`);
  else toast(`${files.length}장을 올렸습니다`);
  renderProject(projectId);
}

// ───────────── 관리자: 참가자 목록 ─────────────
const renderUsers = guard(async () => {
  const { users } = await api('/api/admin/users');
  app.innerHTML = `
    <div class="wrap">
      <a class="back" href="#/">← 전체 건축물</a>
      <div class="page-head"><div class="grow"><h1>참가자</h1><div class="meta">${users.length}명 · 비밀번호를 잊은 분은 여기서 새로 정해드리세요</div></div></div>
      <table class="users">
        <thead><tr><th>이름</th><th>가입일</th><th>사진</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${fmtDate(u.created_at)}</td><td>${u.photo_count}장</td>
          <td style="text-align:right"><button class="btn sm ghost" data-reset="${u.id}" data-name="${esc(u.name)}">비밀번호 재설정</button></td></tr>`).join('')
          || '<tr><td colspan="4" class="muted">아직 가입한 참가자가 없습니다</td></tr>'}</tbody>
      </table>
    </div>`;
  app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = guard(async () => {
    const pw = prompt(`${b.dataset.name}님의 새 비밀번호 (4자 이상)`);
    if (!pw) return;
    await api(`/api/admin/users/${b.dataset.reset}/password`, { method: 'POST', body: { password: pw } });
    toast('비밀번호를 바꿨습니다. 새 비밀번호를 전해주세요.');
  })));
});

boot().catch((e) => { app.innerHTML = `<div class="auth"><p class="err">${esc(e.message)}</p></div>`; });
