// GenshinDPS サーバー
//  - public/ の静的ファイル配信
//  - /api/enka/:uid  Enka.Network API のプロキシ（ブラウザから直接呼べないため。CORS・User-Agent・キャッシュ対応）
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;
const ENKA_BASE = process.env.ENKA_BASE || 'https://enka.network/api/uid';
const USER_AGENT = process.env.ENKA_USER_AGENT || 'GenshinDPS/0.1 (+https://github.com/mizugamiaqua/GenshinDPS)';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

// Enka のレスポンスは ttl 秒間キャッシュする（Enka 側の推奨）
const enkaCache = new Map();

export async function fetchEnka(uid, fetchImpl = fetch) {
  const cached = enkaCache.get(uid);
  if (cached && cached.expires > Date.now()) return { status: 200, body: cached.body, cached: true };
  const res = await fetchImpl(`${ENKA_BASE}/${uid}/`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (res.ok) {
    let ttl = 60;
    try {
      ttl = Math.max(30, Number(JSON.parse(text).ttl) || 60);
    } catch {
      return { status: 502, body: JSON.stringify({ error: 'Enka.Network から不正なレスポンスを受け取りました。' }) };
    }
    enkaCache.set(uid, { body: text, expires: Date.now() + ttl * 1000 });
    return { status: 200, body: text };
  }
  return { status: res.status, body: JSON.stringify({ error: `Enka.Network: HTTP ${res.status}`, status: res.status }) };
}

function send(req, res, status, body, type, extraHeaders = {}) {
  const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extraHeaders };
  let payload = typeof body === 'string' ? Buffer.from(body) : body;
  if (payload.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    payload = gzipSync(payload);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = payload.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep)) return send(req, res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = extname(file);
    const data = await readFile(file);
    const cache = ext === '.json' && rel.startsWith('/data/') ? 'public, max-age=3600' : 'no-cache';
    if (COMPRESSIBLE.has(ext)) return send(req, res, 200, data, MIME[ext], { 'Cache-Control': cache });
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': cache });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(req, res, 404, 'Not Found', 'text/plain; charset=utf-8');
  }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(req, res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
  }
  const m = url.pathname.match(/^\/api\/enka\/([^/]+)\/?$/);
  if (m) {
    const uid = m[1];
    if (!/^(18|[1-9])\d{8}$/.test(uid)) {
      return send(req, res, 400, JSON.stringify({ error: 'UIDの形式が正しくありません。', status: 400 }), MIME['.json']);
    }
    try {
      const r = await fetchEnka(uid);
      return send(req, res, r.status, r.body, MIME['.json'], { 'Cache-Control': 'no-store' });
    } catch (err) {
      console.error('[enka]', err);
      return send(req, res, 502, JSON.stringify({ error: 'Enka.Network に接続できませんでした。', status: 502 }), MIME['.json']);
    }
  }
  return serveStatic(req, res, url.pathname);
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, () => console.log(`GenshinDPS: http://localhost:${PORT}`));
}
