// 권한 규칙을 실제 서버에 HTTP로 확인한다.  npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'ohs-test-'));
let server;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);

function client() {
  let cookie = '';
  const req = async (url, { method = 'GET', body, form, headers = {} } = {}) => {
    const h = { 'X-Requested-With': 'ohs', ...headers };
    if (cookie) h.Cookie = cookie;
    if (body) h['Content-Type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers: h, body: form || (body && JSON.stringify(body)) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return r;
  };
  return req;
}
const upload = (c, pid, name = 'a.jpg') => {
  const fd = new FormData();
  fd.append('file', new Blob([JPEG], { type: 'image/jpeg' }), name);
  return c(`/api/projects/${pid}/photos`, { method: 'POST', form: fd });
};

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT, DATA_DIR: dataDir, ADMIN_PASSWORD: 'adminpw', JOIN_CODE: 'OHS', MAX_PHOTOS_PER_USER: '2' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('http') && res()));
});
after(() => { server.kill(); rmSync(dataDir, { recursive: true, force: true }); });

test('권한 시나리오 전체', async () => {
  const admin = client(), alice = client(), bob = client(), stranger = client();

  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await admin('/api/admin/login', { method: 'POST', body: { password: 'adminpw' } })).status, 200);
  const p1 = (await (await admin('/api/projects', { method: 'POST', body: { name: '건축물 A', architect: '김소장' } })).json()).id;
  const p2 = (await (await admin('/api/projects', { method: 'POST', body: { name: '건축물 B' } })).json()).id;

  // 참가 코드 필요
  assert.equal((await alice('/api/register', { method: 'POST', body: { name: 'alice', password: '1234' } })).status, 403);
  assert.equal((await alice('/api/register', { method: 'POST', body: { name: 'alice', password: '1234', join_code: 'OHS' } })).status, 200);
  assert.equal((await bob('/api/register', { method: 'POST', body: { name: 'bob', password: '5678', join_code: 'OHS' } })).status, 200);

  // 비로그인은 아무것도 못 본다
  assert.equal((await stranger('/api/projects')).status, 401);

  // 참가자는 프로젝트를 만들 수 없고 공유 토큰도 못 본다
  assert.equal((await alice('/api/projects', { method: 'POST', body: { name: 'x' } })).status, 403);
  const plist = await (await alice('/api/projects')).json();
  assert.equal(plist.projects.length, 2);
  assert.ok(plist.projects.every((p) => p.share_token === undefined));

  // 업로드
  const a1 = (await (await upload(alice, p1)).json()).id;
  const b1 = (await (await upload(bob, p1)).json()).id;
  const b2 = (await (await upload(bob, p2)).json()).id;
  assert.ok(a1 && b1 && b2);
  // 1인당 장수 제한 (테스트에선 2장): bob 은 p1 에 1장 → 1장 더 가능, 그다음은 거절
  const b3 = (await (await upload(bob, p1)).json()).id;
  const over = await upload(bob, p1);
  assert.equal(over.status, 409);
  assert.equal((await bob(`/api/photos/${b3}`, { method: 'DELETE' })).status, 200);
  assert.equal((await upload(bob, p1)).status, 200, '지우면 다시 올릴 수 있다');
  const adminStorage = (await (await admin('/api/projects')).json()).storage;
  assert.ok(adminStorage.photos >= 4 && adminStorage.free_bytes > 0);
  assert.equal((await (await alice('/api/projects')).json()).storage, undefined, '참가자에겐 저장 공간 정보 없음');
  const bad = new FormData(); bad.append('file', new Blob(['<script>']), 'x.jpg');
  assert.equal((await alice(`/api/projects/${p1}/photos`, { method: 'POST', form: bad })).status, 415);

  // 참가자는 모든 사진을 본다
  const view = await (await alice(`/api/projects/${p1}`)).json();
  assert.equal(view.photos.length, 3);
  assert.deepEqual(view.photos.map((x) => [x.uploader, x.mine]).sort(), [['alice', true], ['bob', false], ['bob', false]]);
  assert.equal((await alice(`/media/${b2}/orig`)).status, 200);

  // 남의 사진은 못 지운다, 내 사진은 지운다
  assert.equal((await alice(`/api/photos/${b1}`, { method: 'DELETE' })).status, 403);
  assert.equal((await alice(`/api/photos/${a1}`, { method: 'DELETE' })).status, 200);
  assert.equal((await alice(`/media/${a1}/orig`)).status, 404);

  // CSRF: 헤더 없는 요청 거부
  assert.equal((await bob(`/api/photos/${b1}`, { method: 'DELETE', headers: { 'X-Requested-With': '' } })).status, 403);

  // 소장님 링크: 자기 프로젝트만
  const adminList = await (await admin('/api/projects')).json();
  const t1 = adminList.projects.find((p) => p.id === p1).share_token;
  const share = await (await stranger(`/api/share/${t1}`)).json();
  assert.equal(share.project.name, '건축물 A');
  assert.equal(share.photos.length, 2);
  assert.ok(share.photos.every((x) => x.uploader === 'bob') && share.photos.some((x) => x.id === b1));
  assert.equal((await stranger(`/s/${t1}/media/${b1}/orig`)).status, 200);
  assert.equal((await stranger(`/s/${t1}/media/${b2}/orig`)).status, 404, 'B 사진은 A 링크로 못 봄');
  assert.equal((await stranger(`/media/${b1}/orig`)).status, 401, '링크 없이 원본 접근 불가');
  assert.equal((await stranger(`/api/projects/${p2}`)).status, 401);
  const zip = await stranger(`/s/${t1}/download.zip`);
  assert.equal(zip.status, 200);
  const zbuf = Buffer.from(await zip.arrayBuffer());
  assert.equal(zbuf.readUInt32LE(0), 0x04034b50);
  assert.ok(zbuf.includes(JPEG));

  // 링크 재발급 → 이전 링크 무효
  const t1b = (await (await admin(`/api/projects/${p1}/rotate-link`, { method: 'POST' })).json()).share_token;
  assert.equal((await stranger(`/api/share/${t1}`)).status, 404);
  assert.equal((await stranger(`/api/share/${t1b}`)).status, 200);

  // 관리자는 누구 사진이든 지운다
  assert.equal((await admin(`/api/photos/${b2}`, { method: 'DELETE' })).status, 200);

  // 비밀번호 재설정 → 기존 세션 끊김
  const users = (await (await admin('/api/admin/users')).json()).users;
  const bobId = users.find((u) => u.name === 'bob').id;
  assert.equal((await alice('/api/admin/users')).status, 403);
  assert.equal((await admin(`/api/admin/users/${bobId}/password`, { method: 'POST', body: { password: 'newpw' } })).status, 200);
  assert.equal((await bob('/api/projects')).status, 401);
  assert.equal((await bob('/api/login', { method: 'POST', body: { name: 'bob', password: 'newpw' } })).status, 200);
});
