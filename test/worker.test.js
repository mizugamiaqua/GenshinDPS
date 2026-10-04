import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/enka-proxy/worker.js';

// Cloudflare Workers の caches.default を簡易的に再現
const store = new Map();
globalThis.caches = {
  default: {
    match: async (req) => store.get(req.url)?.clone(),
    put: async (req, res) => { store.set(req.url, res); },
  },
};
const ctx = { waitUntil: (p) => p };
let upstream;
const realFetch = globalThis.fetch;
beforeEach(() => {
  store.clear();
  upstream = [];
  globalThis.fetch = async (url) => {
    upstream.push(url);
    if (url.includes('800000001')) return new Response(JSON.stringify({ uid: '800000001', ttl: 60 }), { status: 200 });
    return new Response('', { status: 404 });
  };
});
process.on('exit', () => { globalThis.fetch = realFetch; });

const req = (path, init = {}) => new Request(`https://proxy.example.dev${path}`, init);

test('UIDを中継し、CORSヘッダーを付ける', async () => {
  const res = await worker.fetch(req('/800000001', { headers: { Origin: 'https://user.github.io' } }), {}, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await res.json()).uid, '800000001');
  assert.deepEqual(upstream, ['https://enka.network/api/uid/800000001/']);
});

test('2回目はキャッシュから返す', async () => {
  await worker.fetch(req('/800000001'), {}, ctx);
  const res = await worker.fetch(req('/800000001'), {}, ctx);
  assert.equal(res.headers.get('X-Cache'), 'HIT');
  assert.equal(upstream.length, 1);
});

test('不正なUID・Enkaのエラー・プリフライト', async () => {
  assert.equal((await worker.fetch(req('/abc'), {}, ctx)).status, 400);
  const nf = await worker.fetch(req('/800000002'), {}, ctx);
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).status, 404);
  assert.equal((await worker.fetch(req('/800000001', { method: 'OPTIONS' }), {}, ctx)).status, 204);
});

test('ALLOWED_ORIGINS で許可オリジンを制限できる', async () => {
  const env = { ALLOWED_ORIGINS: 'https://user.github.io' };
  const ok = await worker.fetch(req('/800000001', { headers: { Origin: 'https://user.github.io' } }), env, ctx);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://user.github.io');
  const ng = await worker.fetch(req('/800000001', { headers: { Origin: 'https://evil.example' } }), env, ctx);
  assert.equal(ng.status, 403);
});
