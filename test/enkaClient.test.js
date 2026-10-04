import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnkaError, detectGitHubRepo, fetchEnkaData, githubConfig, issueUrl, waitForGitHub } from '../public/js/enkaClient.js';

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const htmlRes = (status = 404) => new Response('<html>Not Found</html>', { status, headers: { 'Content-Type': 'text/html' } });
const gh = githubConfig({ github: { repo: 'owner/GenshinDPS' } });
const record = (fetchedAt, extra = {}) => ({ uid: '800000001', playerInfo: { nickname: 'x' }, avatarInfoList: [], _meta: { fetchedAt, ...extra } });

test('GitHub Pages のURLからリポジトリを推定', () => {
  assert.equal(detectGitHubRepo({ hostname: 'mizugamiaqua.github.io', pathname: '/GenshinDPS/' }), 'mizugamiaqua/GenshinDPS');
  assert.equal(detectGitHubRepo({ hostname: 'user.github.io', pathname: '/' }), 'user/user.github.io');
  assert.equal(detectGitHubRepo({ hostname: 'localhost', pathname: '/' }), null);
  assert.equal(githubConfig({}, { hostname: 'localhost', pathname: '/' }), null);
});

test('Issue作成URLにUIDが入る', () => {
  const u = new URL(issueUrl('800000001', gh));
  assert.equal(u.pathname, '/owner/GenshinDPS/issues/new');
  assert.equal(u.searchParams.get('title'), '[UID] 800000001');
});

test('同一オリジンのAPIがあればそれを使う', async () => {
  const r = await fetchEnkaData('800000001', { github: gh }, async () => jsonRes({ uid: '800000001' }));
  assert.equal(r.via, 'server');
});

test('GitHub Pages: APIが無ければGitHubの保存データを使う', async () => {
  const calls = [];
  const r = await fetchEnkaData('800000001', { github: gh }, async (url) => {
    calls.push(url);
    if (url.startsWith('api/')) return htmlRes();
    return new Response(JSON.stringify(record('2026-10-04T00:00:00Z')), { status: 200 });
  });
  assert.equal(r.via, 'github');
  assert.equal(r.fetchedAt, '2026-10-04T00:00:00Z');
  assert.match(calls[1], /^https:\/\/api\.github\.com\/repos\/owner\/GenshinDPS\/contents\/uid\/800000001\.json\?ref=enka-data/);
});

test('APIがレート制限なら raw.githubusercontent.com を使う', async () => {
  const calls = [];
  const r = await fetchEnkaData('800000001', { sameOrigin: false, github: gh }, async (url) => {
    calls.push(url);
    if (url.includes('api.github.com')) return new Response('{}', { status: 403 });
    return new Response(JSON.stringify(record('2026-10-04T00:00:00Z')), { status: 200 });
  });
  assert.equal(r.via, 'github');
  assert.match(calls[1], /^https:\/\/raw\.githubusercontent\.com\/owner\/GenshinDPS\/enka-data\/uid\/800000001\.json/);
});

test('保存データが無ければ not-cached（取得依頼を促す）', async () => {
  await assert.rejects(
    fetchEnkaData('800000001', { sameOrigin: false, github: gh }, async () => new Response('', { status: 404 })),
    (err) => err instanceof EnkaError && err.code === 'not-cached',
  );
});

test('サーバーがEnkaのエラーを返したらその場で打ち切る', async () => {
  await assert.rejects(
    fetchEnkaData('800000001', { github: gh }, async () => jsonRes({ error: 'x', status: 404 }, 404)),
    (err) => err.status === 404 && /見つかりません/.test(err.message),
  );
});

test('waitForGitHub: 依頼後に保存されたデータを検知する', async () => {
  const since = '2026-10-04T10:00:00Z';
  let n = 0;
  const r = await waitForGitHub('800000001', gh, since, { interval: 1 }, async () => {
    n++;
    if (n === 1) return new Response('', { status: 404 });
    if (n === 2) return new Response(JSON.stringify(record('2026-10-03T00:00:00Z')), { status: 200 }); // 古いデータ
    return new Response(JSON.stringify(record('2026-10-04T10:00:30Z')), { status: 200 });
  });
  assert.equal(r.fetchedAt, '2026-10-04T10:00:30Z');
  assert.equal(n, 3);
});

test('waitForGitHub: Actions側のエラーを伝える・タイムアウトする', async () => {
  const since = '2026-10-04T10:00:00Z';
  await assert.rejects(
    waitForGitHub('800000001', gh, since, { interval: 1 }, async () => new Response(JSON.stringify({
      uid: '800000001', _meta: { fetchedAt: null, lastError: { status: 404, message: 'プレイヤーが見つかりません。', at: '2026-10-04T10:00:20Z' } },
    }), { status: 200 })),
    (err) => err.status === 404,
  );
  await assert.rejects(
    waitForGitHub('800000001', gh, since, { interval: 1, timeout: 5 }, async () => new Response('', { status: 404 })),
    (err) => err.code === 'timeout',
  );
});
