#!/usr/bin/env node
/**
 * 빌드 — src/ 의 조각들을 하나의 index.html 로 합친다.
 *
 *   node scripts/build.mjs            dist/index.html 생성
 *   node scripts/build.mjs --dev      생성 + 로컬 서버(:5173) + 파일 감시
 *
 * 의존성 없음. Node 18+ 면 바로 돌아간다.
 *
 * 왜 번들러를 쓰지 않는가:
 *  - Artifact 로 배포할 때는 외부 스크립트를 불러올 수 없어 어차피 한 파일이어야 한다.
 *  - 순서대로 이어 붙이기만 하면 되므로 도구가 늘어날 이유가 없다.
 *  - 스크립트는 모듈이 아니라 전역 스코프를 공유한다. 아래 ORDER 순서가 곧 의존 순서다.
 */
import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => resolve(ROOT, ...s);

/** 합치는 순서. 전역을 공유하므로 정의 → 사용 순서를 지킬 것. */
const HEAD = 'src/index.head.html';   // <title> · <link> · <style>
const BODY = 'src/index.body.html';   // 마크업
const SCRIPTS = [
  'src/data/geo.js',    // 행정경계 데이터 (window.KRGEO)
  'src/core.js',        // 상수 · 저장소 백엔드 · 마이그레이션 · 부팅
  'src/map.js',         // 지도 엔진
  'src/projects.js',    // 프로젝트 목록 · 상세 · 사진 · 기록
  'src/elevation.js',   // 입면 원근 보정 · 선 추출 · 내보내기
  'src/import.js',      // CSV · GeoJSON · Shapefile · ZIP 가져오기 + 좌표계 변환
  'src/pptx.js',        // ZIP + OOXML → 진짜 .pptx 내보내기
  'src/analysis.js'     // 분석 · 출력 · 설정  (마지막 줄에서 boot() 호출)
];

function build() {
  const parts = [readFileSync(p(HEAD), 'utf8'), readFileSync(p(BODY), 'utf8')];
  for (const f of SCRIPTS) parts.push(`<script>\n/* ---- ${f} ---- */\n${readFileSync(p(f), 'utf8')}\n</script>`);
  const html = parts.join('\n');
  mkdirSync(p('dist'), { recursive: true });
  writeFileSync(p('dist/index.html'), html);

  /* 로컬에서 브라우저로 바로 열어볼 수 있는 완전한 문서.
     Artifact 는 게시할 때 doctype·head·body 를 스스로 감싸므로 dist/index.html 에는 넣지 않는다. */
  writeFileSync(p('dist/preview.html'),
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>\n${html}\n</body></html>`);

  const kb = (html.length / 1024).toFixed(0);
  console.log(`[build] dist/index.html  ${kb} KB  (${new Date().toLocaleTimeString('ko-KR')})`);
  if (html.length > 16 * 1024 * 1024) console.warn('[build] 경고: Artifact 한도 16MB 를 넘었습니다.');
  return html;
}

build();

if (process.argv.includes('--dev')) {
  const PORT = Number(process.env.PORT || 5173);
  let timer = null;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(() => { try { build(); } catch (e) { console.error('[build] 실패:', e.message); } }, 120); };
  for (const f of [HEAD, BODY, ...SCRIPTS]) watch(p(f), rebuild);
  createServer((req, res) => {
    try {
      const body = readFileSync(p('dist/preview.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  }).listen(PORT, () => console.log(`[dev] http://localhost:${PORT}  — 파일을 저장하면 다시 빌드됩니다. 브라우저는 새로고침하세요.`));
}
