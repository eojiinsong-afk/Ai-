// 소장님 전용 화면: 링크(토큰)에 해당하는 건축물 사진만 보인다. 로그인·업로드·삭제 없음.
import { $, esc, api, photoTile, lightbox } from '/common.js';

const tokenId = location.pathname.split('/')[2];
const base = `/s/${tokenId}`;
const src = (ph, kind) => `${base}/media/${ph.id}/${kind}`;
const app = $('#app');

try {
  const { project: p, photos } = await api(`/api/share/${tokenId}`);
  document.title = `${p.name} · 오픈하우스 사진함`;
  const people = [...new Set(photos.map((x) => x.uploader))];
  app.innerHTML = `
    <div class="wrap">
      <div class="page-head">
        <div class="grow"><h1>${esc(p.name)}</h1>
          <div class="meta">${[p.architect, p.visit_date].filter(Boolean).map(esc).join(' · ')}${p.architect || p.visit_date ? ' · ' : ''}사진 ${photos.length}장 · 참가자 ${people.length}명</div></div>
        ${photos.length ? `<div class="actions"><a class="btn primary" href="${base}/download.zip">전체 다운로드 (ZIP)</a></div>` : ''}
      </div>
      <div class="share-note">오픈하우스서울 투어 참가자들이 찍은 사진입니다. 사진 아래 이름이 촬영자이니 사용하실 때 함께 밝혀주세요.</div>
      ${photos.length ? `<div class="grid-photos">${photos.map((ph) => photoTile(ph, src)).join('')}</div>`
        : '<div class="empty-state">아직 올라온 사진이 없습니다. 투어가 끝난 뒤 다시 열어보세요.</div>'}
    </div>`;
  app.querySelector('.grid-photos')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.ph');
    if (tile && e.target.closest('.open')) lightbox(photos, photos.findIndex((x) => x.id === Number(tile.dataset.id)), src);
  });
} catch (e) {
  app.innerHTML = `<div class="auth"><h1>링크를 열 수 없습니다</h1><p class="lead">${esc(e.message)}<br>오픈하우스서울 담당자에게 새 링크를 요청해주세요.</p></div>`;
}
