import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnkaError, endpoints, fetchEnkaData } from '../public/js/enkaClient.js';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const htmlRes = (status = 404) => new Response('<html>Not Found</html>', { status, headers: { 'Content-Type': 'text/html' } });

test('取得先の順序とプロキシURLの組み立て', () => {
  assert.deepEqual(endpoints('800000001').map((e) => e.kind), ['server', 'direct']);
  const eps = endpoints('800000001', { proxy: 'https://p.example.dev/', sameOrigin: false });
  assert.deepEqual(eps.map((e) => e.url), ['https://p.example.dev/800000001', 'https://enka.network/api/uid/800000001/']);
  assert.equal(endpoints('800000001', { proxy: 'https://p.example.dev/?uid={uid}' })[1].url, 'https://p.example.dev/?uid=800000001');
});

test('同一オリジンのAPIがあればそれを使う', async () => {
  const calls = [];
  const r = await fetchEnkaData('800000001', {}, async (url) => { calls.push(url); return jsonRes({ uid: '800000001' }); });
  assert.equal(r.via, 'server');
  assert.equal(calls.length, 1);
});

test('GitHub Pages: APIが404(HTML)ならプロキシへフォールバック', async () => {
  const calls = [];
  const r = await fetchEnkaData('800000001', { proxy: 'https://p.example.dev' }, async (url) => {
    calls.push(url);
    return url.startsWith('api/') ? htmlRes() : jsonRes({ uid: '800000001', avatarInfoList: [] });
  });
  assert.equal(r.via, 'proxy');
  assert.deepEqual(calls, ['api/enka/800000001', 'https://p.example.dev/800000001']);
});

test('CORSで拒否されたら次の経路、全滅ならわかりやすいエラー', async () => {
  await assert.rejects(
    fetchEnkaData('800000001', { sameOrigin: false }, async () => { throw new TypeError('Failed to fetch'); }),
    (err) => err instanceof EnkaError && /接続設定/.test(err.message),
  );
});

test('Enka自体のエラー（プレイヤー不在）はその場で打ち切る', async () => {
  let n = 0;
  await assert.rejects(
    fetchEnkaData('800000001', { proxy: 'https://p.example.dev' }, async () => { n++; return jsonRes({ error: 'x', status: 404 }, 404); }),
    (err) => err.status === 404 && /見つかりません/.test(err.message),
  );
  assert.equal(n, 1);
});
