// 오픈하우스서울 사진 공유 서버 — 외부 의존성 없음 (Node 22.13+)
//
// 권한 요약
//   관리자   : 모든 프로젝트·사진 열람/삭제, 프로젝트 생성·수정, 소장님 링크 발급·재발급
//   참가자   : 모든 프로젝트·사진 열람, 사진 업로드, "본인 사진만" 삭제
//   소장님   : 로그인 없음. /s/<토큰> 링크로 해당 프로젝트 사진만 열람·다운로드
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamZip } from './lib/zip.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const JOIN_CODE = process.env.JOIN_CODE || ''; // 비워두면 누구나 가입 가능
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 40);
const SESSION_DAYS = 60;

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD 환경변수를 설정하세요. 예) ADMIN_PASSWORD=비밀번호 npm start');
  process.exit(1);
}
mkdirSync(UPLOAD_DIR, { recursive: true });

// ───────────────────────── DB ─────────────────────────
const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,            -- sha256(쿠키 값)
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin','participant')),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    architect TEXT NOT NULL DEFAULT '',
    visit_date TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    share_token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    thumb TEXT,
    mime TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS photos_project ON photos(project_id);
`);
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

const q = {
  userByName: db.prepare('SELECT * FROM users WHERE name = ?'),
  insertUser: db.prepare('INSERT INTO users (name, pw, created_at) VALUES (?, ?, ?)'),
  setPw: db.prepare('UPDATE users SET pw = ? WHERE id = ?'),
  session: db.prepare(`SELECT s.*, u.name FROM sessions s LEFT JOIN users u ON u.id = s.user_id
                       WHERE s.id = ? AND s.expires_at > ?`),
  insertSession: db.prepare('INSERT INTO sessions (id, user_id, role, expires_at) VALUES (?, ?, ?, ?)'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  projects: db.prepare(`SELECT p.*, COUNT(ph.id) AS photo_count,
                          (SELECT id FROM photos WHERE project_id = p.id ORDER BY id DESC LIMIT 1) AS cover_id
                        FROM projects p LEFT JOIN photos ph ON ph.project_id = p.id
                        GROUP BY p.id ORDER BY p.visit_date DESC, p.id DESC`),
  project: db.prepare('SELECT * FROM projects WHERE id = ?'),
  projectByToken: db.prepare('SELECT * FROM projects WHERE share_token = ?'),
  insertProject: db.prepare(`INSERT INTO projects (name, architect, visit_date, description, share_token, created_at)
                             VALUES (?, ?, ?, ?, ?, ?)`),
  updateProject: db.prepare('UPDATE projects SET name = ?, architect = ?, visit_date = ?, description = ? WHERE id = ?'),
  setToken: db.prepare('UPDATE projects SET share_token = ? WHERE id = ?'),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  photos: db.prepare(`SELECT ph.id, ph.user_id, ph.mime, ph.original_name, ph.size, ph.caption, ph.created_at,
                        ph.thumb IS NOT NULL AS has_thumb, u.name AS uploader
                      FROM photos ph JOIN users u ON u.id = ph.user_id
                      WHERE ph.project_id = ? ORDER BY ph.id DESC`),
  photoFiles: db.prepare(`SELECT ph.*, u.name AS uploader FROM photos ph JOIN users u ON u.id = ph.user_id
                          WHERE ph.project_id = ? ORDER BY ph.id`),
  photo: db.prepare('SELECT * FROM photos WHERE id = ?'),
  insertPhoto: db.prepare(`INSERT INTO photos (project_id, user_id, file, thumb, mime, original_name, size, caption, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  deletePhoto: db.prepare('DELETE FROM photos WHERE id = ?'),
  users: db.prepare(`SELECT u.id, u.name, u.created_at, COUNT(ph.id) AS photo_count
                     FROM users u LEFT JOIN photos ph ON ph.user_id = u.id GROUP BY u.id ORDER BY u.name`),
};

// ───────────────────────── 유틸 ─────────────────────────
const token = (bytes = 18) => randomBytes(bytes).toString('base64url');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function hashPw(pw) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPw(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(a, Buffer.from(hash, 'hex'));
}
function safeEqual(a, b) {
  const x = Buffer.from(sha256(String(a))), y = Buffer.from(sha256(String(b)));
  return timingSafeEqual(x, y);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new HttpError(413, '요청이 너무 큽니다'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new HttpError(400, '잘못된 요청입니다'); }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isHttps(req) {
  return process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
}

function setSessionCookie(req, res, value, maxAgeSec) {
  const attrs = [`ohs=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function getSession(req) {
  const raw = parseCookies(req).ohs;
  if (!raw) return null;
  return q.session.get(sha256(raw), Date.now()) || null;
}

function startSession(req, res, role, userId = null) {
  const raw = token(32);
  q.insertSession.run(sha256(raw), userId, role, Date.now() + SESSION_DAYS * 864e5);
  setSessionCookie(req, res, raw, SESSION_DAYS * 86400);
}

function requireAuth(session) {
  if (!session) throw new HttpError(401, '로그인이 필요합니다');
  return session;
}
function requireAdmin(session) {
  if (!session || session.role !== 'admin') throw new HttpError(403, '관리자만 할 수 있습니다');
  return session;
}

// 로그인 시도 제한: IP당 10분에 20회
const attempts = new Map();
function rateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 20) throw new HttpError(429, '시도가 너무 많습니다. 잠시 후 다시 해주세요');
  list.push(now); attempts.set(ip, list);
}

// 파일 내용으로 형식 판별 (확장자·Content-Type은 믿지 않는다)
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
    if (brand === 'avif') return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function contentDisposition(type, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function serveFile(req, res, file, mime, { download = null, immutable = true } = {}) {
  const full = path.join(UPLOAD_DIR, path.basename(file));
  if (!existsSync(full)) throw new HttpError(404, '파일이 없습니다');
  const { size } = statSync(full);
  const headers = {
    'Content-Type': mime,
    'Content-Length': size,
    'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (download) headers['Content-Disposition'] = contentDisposition('attachment', download);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(full).pipe(res);
}

function projectOut(p, session) {
  const out = {
    id: p.id, name: p.name, architect: p.architect, visit_date: p.visit_date,
    description: p.description, photo_count: p.photo_count ?? undefined, cover_id: p.cover_id ?? null,
  };
  if (session?.role === 'admin') out.share_token = p.share_token;
  return out;
}

function photoOut(ph, session) {
  return {
    id: ph.id, uploader: ph.uploader, caption: ph.caption, original_name: ph.original_name,
    size: ph.size, mime: ph.mime, created_at: ph.created_at, has_thumb: !!ph.has_thumb,
    mine: session ? (session.role === 'admin' || ph.user_id === session.user_id) : false,
  };
}

function zipEntries(project) {
  const used = new Set();
  return q.photoFiles.all(project.id).map((ph, i) => {
    const base = `${String(i + 1).padStart(3, '0')}_${ph.uploader}_${ph.original_name}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    let name = base, n = 2;
    while (used.has(name)) name = base.replace(/(\.[^.]*)?$/, `_${n++}$1`);
    used.add(name);
    return { name, path: path.join(UPLOAD_DIR, ph.file), date: new Date(ph.created_at) };
  });
}

async function sendZip(res, project) {
  const filename = `${project.name}_사진.zip`;
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': contentDisposition('attachment', filename),
    'Cache-Control': 'no-store',
  });
  try { await streamZip(res, zipEntries(project)); } catch { res.destroy(); }
}

// ───────────────────────── 업로드 ─────────────────────────
async function handleUpload(req, session, projectId) {
  if (session.role !== 'participant') throw new HttpError(403, '참가자 계정으로 올려주세요');
  if (!q.project.get(projectId)) throw new HttpError(404, '프로젝트가 없습니다');
  const len = Number(req.headers['content-length']);
  if (!len) throw new HttpError(411, '파일 크기를 알 수 없습니다');
  if (len > (MAX_UPLOAD_MB + 2) * 1024 * 1024) throw new HttpError(413, `사진 한 장은 ${MAX_UPLOAD_MB}MB 이하여야 합니다`);

  const form = await new Request('http://local/', {
    method: 'POST', headers: req.headers, body: req, duplex: 'half',
  }).formData().catch(() => { throw new HttpError(400, '업로드 형식이 올바르지 않습니다'); });

  const file = form.get('file');
  if (!(file instanceof Blob)) throw new HttpError(400, '사진 파일이 없습니다');
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(415, 'JPG·PNG·WEBP·HEIC 사진만 올릴 수 있습니다');

  let thumbBuf = null;
  const thumb = form.get('thumb');
  if (thumb instanceof Blob && thumb.size > 0 && thumb.size < 3 * 1024 * 1024) {
    const tb = Buffer.from(await thumb.arrayBuffer());
    const tk = sniffImage(tb);
    if (tk && (tk.mime === 'image/jpeg' || tk.mime === 'image/webp')) thumbBuf = tb;
  }

  const id = token(12);
  const fileName = `${id}.${kind.ext}`;
  const thumbName = thumbBuf ? `${id}_t.jpg` : null;
  await writeFile(path.join(UPLOAD_DIR, fileName), buf);
  if (thumbBuf) await writeFile(path.join(UPLOAD_DIR, thumbName), thumbBuf);

  const originalName = cleanText(file.name || `photo.${kind.ext}`, 120).replace(/[\\/]/g, '_') || `photo.${kind.ext}`;
  const caption = cleanText(form.get('caption'), 200);
  const r = q.insertPhoto.run(projectId, session.user_id, fileName, thumbName, kind.mime, originalName, buf.length, caption, Date.now());
  return { id: Number(r.lastInsertRowid) };
}

async function removePhotoFiles(ph) {
  for (const f of [ph.file, ph.thumb]) if (f) await unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
}

// ───────────────────────── 정적 파일 ─────────────────────────
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/share.js': ['share.js', 'text/javascript; charset=utf-8'],
  '/common.js': ['common.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
async function serveStatic(res, name, type) {
  const body = await readFile(path.join(ROOT, 'public', name));
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

// ───────────────────────── 라우팅 ─────────────────────────
async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  const m = req.method;
  let match;

  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer'); // 소장님 링크 토큰이 외부로 새지 않게

  // 상태를 바꾸는 API는 같은 사이트의 fetch 에서만 (CSRF 방지)
  if (m !== 'GET' && m !== 'HEAD' && p.startsWith('/api/') && req.headers['x-requested-with'] !== 'ohs') {
    throw new HttpError(403, '허용되지 않은 요청입니다');
  }

  if ((m === 'GET' || m === 'HEAD') && STATIC[p]) return serveStatic(res, ...STATIC[p]);

  // ── 소장님 공유 링크 (로그인 없음, 토큰 = 권한) ──
  if ((match = p.match(/^\/s\/([\w-]{10,})\/?$/)) && m === 'GET') {
    return serveStatic(res, 'share.html', 'text/html; charset=utf-8');
  }
  if ((match = p.match(/^\/api\/share\/([\w-]{10,})$/)) && m === 'GET') {
    const project = q.projectByToken.get(match[1]);
    if (!project) throw new HttpError(404, '링크가 만료되었거나 잘못되었습니다');
    return json(res, 200, { project: projectOut(project, null), photos: q.photos.all(project.id).map((ph) => photoOut(ph, null)) });
  }
  if ((match = p.match(/^\/s\/([\w-]{10,})\/media\/(\d+)\/(orig|thumb|download)$/)) && (m === 'GET' || m === 'HEAD')) {
    const project = q.projectByToken.get(match[1]);
    const ph = project && q.photo.get(Number(match[2]));
    if (!ph || ph.project_id !== project.id) throw new HttpError(404, '사진이 없습니다');
    return sendMedia(req, res, ph, match[3]);
  }
  if ((match = p.match(/^\/s\/([\w-]{10,})\/download\.zip$/)) && m === 'GET') {
    const project = q.projectByToken.get(match[1]);
    if (!project) throw new HttpError(404, '링크가 만료되었거나 잘못되었습니다');
    return sendZip(res, project);
  }

  const session = getSession(req);

  // ── 인증 ──
  if (p === '/api/me' && m === 'GET') {
    return json(res, 200, {
      user: session ? { role: session.role, name: session.role === 'admin' ? '관리자' : session.name, id: session.user_id } : null,
      join_code_required: !!JOIN_CODE,
    });
  }
  if (p === '/api/register' && m === 'POST') {
    rateLimit(req);
    const b = await readJson(req);
    const name = cleanText(b.name, 30);
    const pw = String(b.password || '');
    if (JOIN_CODE && !safeEqual(String(b.join_code || '').trim(), JOIN_CODE)) throw new HttpError(403, '참가 코드가 맞지 않습니다');
    if (name.length < 2) throw new HttpError(400, '이름은 2자 이상 입력해주세요');
    if (pw.length < 4) throw new HttpError(400, '비밀번호는 4자 이상 입력해주세요');
    if (q.userByName.get(name)) throw new HttpError(409, '이미 사용 중인 이름입니다');
    const r = q.insertUser.run(name, hashPw(pw), Date.now());
    startSession(req, res, 'participant', Number(r.lastInsertRowid));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/login' && m === 'POST') {
    rateLimit(req);
    const b = await readJson(req);
    const u = q.userByName.get(cleanText(b.name, 30));
    if (!u || !checkPw(String(b.password || ''), u.pw)) throw new HttpError(401, '이름 또는 비밀번호가 맞지 않습니다');
    startSession(req, res, 'participant', u.id);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/login' && m === 'POST') {
    rateLimit(req);
    const b = await readJson(req);
    if (!safeEqual(String(b.password || ''), ADMIN_PASSWORD)) throw new HttpError(401, '관리자 비밀번호가 맞지 않습니다');
    startSession(req, res, 'admin');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/logout' && m === 'POST') {
    const raw = parseCookies(req).ohs;
    if (raw) q.deleteSession.run(sha256(raw));
    setSessionCookie(req, res, '', 0);
    return json(res, 200, { ok: true });
  }

  // ── 프로젝트 ──
  if (p === '/api/projects' && m === 'GET') {
    requireAuth(session);
    return json(res, 200, { projects: q.projects.all().map((x) => projectOut(x, session)) });
  }
  if (p === '/api/projects' && m === 'POST') {
    requireAdmin(session);
    const b = await readJson(req);
    const name = cleanText(b.name, 100);
    if (!name) throw new HttpError(400, '건축물 이름을 입력해주세요');
    const r = q.insertProject.run(name, cleanText(b.architect, 100), cleanText(b.visit_date, 20), cleanText(b.description, 1000), token(), Date.now());
    return json(res, 200, { id: Number(r.lastInsertRowid) });
  }
  if ((match = p.match(/^\/api\/projects\/(\d+)$/))) {
    const id = Number(match[1]);
    const project = q.project.get(id);
    if (m === 'GET') {
      requireAuth(session);
      if (!project) throw new HttpError(404, '프로젝트가 없습니다');
      return json(res, 200, { project: projectOut(project, session), photos: q.photos.all(id).map((ph) => photoOut(ph, session)) });
    }
    requireAdmin(session);
    if (!project) throw new HttpError(404, '프로젝트가 없습니다');
    if (m === 'PATCH') {
      const b = await readJson(req);
      const name = cleanText(b.name ?? project.name, 100);
      if (!name) throw new HttpError(400, '건축물 이름을 입력해주세요');
      q.updateProject.run(name, cleanText(b.architect ?? project.architect, 100), cleanText(b.visit_date ?? project.visit_date, 20),
        cleanText(b.description ?? project.description, 1000), id);
      return json(res, 200, { ok: true });
    }
    if (m === 'DELETE') {
      const files = q.photoFiles.all(id);
      q.deleteProject.run(id);
      for (const ph of files) await removePhotoFiles(ph);
      return json(res, 200, { ok: true });
    }
  }
  if ((match = p.match(/^\/api\/projects\/(\d+)\/rotate-link$/)) && m === 'POST') {
    requireAdmin(session);
    const id = Number(match[1]);
    if (!q.project.get(id)) throw new HttpError(404, '프로젝트가 없습니다');
    const t = token();
    q.setToken.run(t, id);
    return json(res, 200, { share_token: t });
  }
  if ((match = p.match(/^\/api\/projects\/(\d+)\/photos$/)) && m === 'POST') {
    return json(res, 200, await handleUpload(req, requireAuth(session), Number(match[1])));
  }
  if ((match = p.match(/^\/api\/projects\/(\d+)\/download\.zip$/)) && m === 'GET') {
    requireAuth(session);
    const project = q.project.get(Number(match[1]));
    if (!project) throw new HttpError(404, '프로젝트가 없습니다');
    return sendZip(res, project);
  }

  // ── 사진 ──
  if ((match = p.match(/^\/api\/photos\/(\d+)$/)) && m === 'DELETE') {
    requireAuth(session);
    const ph = q.photo.get(Number(match[1]));
    if (!ph) throw new HttpError(404, '사진이 없습니다');
    // 핵심 규칙: 참가자는 본인이 올린 사진만 지울 수 있다
    if (session.role !== 'admin' && ph.user_id !== session.user_id) throw new HttpError(403, '본인이 올린 사진만 삭제할 수 있습니다');
    q.deletePhoto.run(ph.id);
    await removePhotoFiles(ph);
    return json(res, 200, { ok: true });
  }
  if ((match = p.match(/^\/media\/(\d+)\/(orig|thumb|download)$/)) && (m === 'GET' || m === 'HEAD')) {
    requireAuth(session);
    const ph = q.photo.get(Number(match[1]));
    if (!ph) throw new HttpError(404, '사진이 없습니다');
    return sendMedia(req, res, ph, match[2]);
  }

  // ── 관리자: 참가자 ──
  if (p === '/api/admin/users' && m === 'GET') {
    requireAdmin(session);
    return json(res, 200, { users: q.users.all() });
  }
  if ((match = p.match(/^\/api\/admin\/users\/(\d+)\/password$/)) && m === 'POST') {
    requireAdmin(session);
    const b = await readJson(req);
    const pw = String(b.password || '');
    if (pw.length < 4) throw new HttpError(400, '비밀번호는 4자 이상 입력해주세요');
    q.setPw.run(hashPw(pw), Number(match[1]));
    q.deleteUserSessions.run(Number(match[1]));
    return json(res, 200, { ok: true });
  }

  throw new HttpError(404, '페이지를 찾을 수 없습니다');
}

function sendMedia(req, res, ph, kind) {
  if (kind === 'thumb' && ph.thumb) return serveFile(req, res, ph.thumb, 'image/jpeg');
  if (kind === 'download') return serveFile(req, res, ph.file, ph.mime, { download: ph.original_name });
  return serveFile(req, res, ph.file, ph.mime);
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.destroy();
    if (req.url.startsWith('/api/')) json(res, status, { error: status === 500 ? '서버 오류가 발생했습니다' : err.message });
    else { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(status === 500 ? '서버 오류' : err.message); }
  }
});
server.requestTimeout = 10 * 60e3; // 느린 휴대폰 업로드 고려
server.listen(PORT, () => console.log(`오픈하우스 사진 공유 · http://localhost:${PORT}`));
