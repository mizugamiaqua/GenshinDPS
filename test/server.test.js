import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEnka, server } from '../server.js';

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('静的ファイルを配信する', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const data = await fetch(`${base}/data/loc.json`);
  assert.equal(data.status, 200);
});

test('ディレクトリトラバーサルを拒否する', async () => {
  const res = await fetch(`${base}/..%2fserver.js`);
  assert.ok([403, 404].includes(res.status));
});

test('不正なUIDは400', async () => {
  const res = await fetch(`${base}/api/enka/abc`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('fetchEnka: 成功時はキャッシュし、エラー時はステータスを返す', async () => {
  let calls = 0;
  const ok = async () => {
    calls++;
    return new Response(JSON.stringify({ uid: '811111111', ttl: 60, avatarInfoList: [] }), { status: 200 });
  };
  const r1 = await fetchEnka('811111111', ok);
  const r2 = await fetchEnka('811111111', ok);
  assert.equal(r1.status, 200);
  assert.equal(r2.cached, true);
  assert.equal(calls, 1);

  const ng = async () => new Response('', { status: 404 });
  const r3 = await fetchEnka('822222222', ng);
  assert.equal(r3.status, 404);
});
