import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, extractUid, fetchEnka } from '../scripts/enka-fetch.mjs';

test('Issueのタイトル・本文からUIDを取り出す', () => {
  assert.equal(extractUid('[UID] 800000001'), '800000001');
  assert.equal(extractUid('', '[UID] ', 'UID: 1800000001\n'), '1800000001');
  assert.equal(extractUid('[UID] 12345'), null);
  assert.equal(extractUid('[UID] 80000000123'), null); // 桁数オーバー
  assert.equal(extractUid('$(rm -rf /) 800000001'), '800000001');
  assert.equal(extractUid(undefined, null), null);
});

test('成功時はEnkaのデータと取得日時を保存', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  const rec = buildRecord(null, { ok: true, uid: '800000001', data: { uid: '800000001', playerInfo: {} } }, now);
  assert.deepEqual(rec._meta, { fetchedAt: '2026-10-04T10:00:00.000Z', source: 'github-actions' });
  assert.ok(rec.playerInfo);
});

test('失敗時は既存データを残してエラーだけ記録', () => {
  const existing = { uid: '800000001', playerInfo: { nickname: 'a' }, _meta: { fetchedAt: '2026-10-01T00:00:00Z' } };
  const now = new Date('2026-10-04T10:00:00Z');
  const rec = buildRecord(existing, { ok: false, uid: '800000001', status: 429, message: '多すぎ' }, now);
  assert.equal(rec.playerInfo.nickname, 'a');
  assert.equal(rec._meta.fetchedAt, '2026-10-01T00:00:00Z');
  assert.deepEqual(rec._meta.lastError, { status: 429, message: '多すぎ', at: '2026-10-04T10:00:00.000Z' });
  const fresh = buildRecord(null, { ok: false, uid: '800000002', status: 404, message: 'なし' }, now);
  assert.equal(fresh.playerInfo, undefined);
  assert.equal(fresh._meta.lastError.status, 404);
});

test('fetchEnka: 429は再試行、404は日本語メッセージ', async () => {
  let n = 0;
  const r = await fetchEnka('800000001', async () => {
    n++;
    return n === 1 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ uid: '800000001' }), { status: 200 });
  }, [1]);
  assert.equal(r.ok, true);
  assert.equal(n, 2);
  const nf = await fetchEnka('800000001', async () => new Response('', { status: 404 }), []);
  assert.equal(nf.ok, false);
  assert.match(nf.message, /見つかりません/);
});
