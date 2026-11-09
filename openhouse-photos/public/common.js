// 참가자 화면과 소장님 화면이 함께 쓰는 도우미

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function api(url, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Requested-With': 'ohs' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `요청 실패 (${res.status})`); e.status = res.status; throw e; }
  return data;
}

export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg; el.setAttribute('role', 'status');
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtSize(n) {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)}GB`;
  return n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

/**
 * 사진 그리드 한 칸
 * @param {object} ph
 * @param {(ph, kind) => string} src  kind = 'thumb' | 'orig' | 'download'
 * @param {{canDelete?: boolean, showMine?: boolean}} opt
 */
export function photoTile(ph, src, opt = {}) {
  const fallback = `<div class="noimg">${esc(ph.original_name)}<br>(미리보기 없음)</div>`;
  return `
    <div class="ph" data-id="${ph.id}">
      <img loading="lazy" decoding="async" alt="${esc(ph.caption || ph.original_name)}" src="${src(ph, 'thumb')}"
           onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'noimg',innerHTML:this.dataset.fb}))"
           data-fb="${esc(fallback)}">
      <button class="open" aria-label="크게 보기"></button>
      ${opt.showMine && ph.mine ? '<span class="mine">내 사진</span>' : ''}
      <div class="cap">© ${esc(ph.uploader)}${ph.caption ? ' · ' + esc(ph.caption) : ''}</div>
      ${opt.canDelete && ph.mine ? '<button class="del" title="삭제" aria-label="삭제">×</button>' : ''}
    </div>`;
}

/** 전체 화면 보기. 좌우 화살표 / 스와이프로 넘긴다. */
export function lightbox(photos, start, src) {
  let i = start;
  const el = document.createElement('div');
  el.className = 'lb';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="lb-top"><span class="count"></span><span class="spacer"></span>
      <a class="btn sm dl">원본 다운로드</a><button class="btn sm close">닫기 ✕</button></div>
    <div class="stage"><img alt=""><button class="nav prev" aria-label="이전">‹</button><button class="nav next" aria-label="다음">›</button></div>
    <div class="lb-bot"></div>`;
  const img = $('img', el);
  const show = () => {
    const ph = photos[i];
    img.src = src(ph, 'orig');
    img.alt = ph.caption || ph.original_name;
    $('.count', el).textContent = `${i + 1} / ${photos.length}`;
    $('.dl', el).href = src(ph, 'download');
    $('.lb-bot', el).innerHTML = `© ${esc(ph.uploader)}${ph.caption ? ' · ' + esc(ph.caption) : ''} <span style="opacity:.6">· ${fmtDate(ph.created_at)} · ${fmtSize(ph.size)}</span>`;
    $('.prev', el).hidden = i === 0;
    $('.next', el).hidden = i === photos.length - 1;
  };
  const go = (d) => { const n = i + d; if (n >= 0 && n < photos.length) { i = n; show(); } };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  $('.close', el).onclick = close;
  $('.prev', el).onclick = () => go(-1);
  $('.next', el).onclick = () => go(1);
  $('.stage', el).addEventListener('click', (e) => { if (e.target.classList.contains('stage')) close(); });
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0 = null; });
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(el);
  show();
}
