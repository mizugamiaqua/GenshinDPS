import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { guessExtraLevels, guessSkillOrder, parseEnkaResponse } from '../public/js/core/enka.js';
import { db, sample } from './helpers.js';

const require = createRequire(import.meta.url);

// genshin-db はデータ生成用の devDependency（CI では未インストールなのでスキップ）
let gdb = null;
try {
  gdb = require('genshin-db');
} catch {
  // 未インストール
}

test('genshin-db にいる全キャラ（旅人以外）が収録されている', { skip: !gdb && 'genshin-db 未インストール' }, () => {
  const ids = new Set(Object.values(db.characters).map((c) => c.avatarId));
  const missing = [];
  for (const name of gdb.characters('names', { matchCategories: true })) {
    const c = gdb.characters(name);
    if (!c || [10000005, 10000007].includes(c.id)) continue;
    if (!gdb.talents(c.name)) continue; // 天賦データが無いキャラ（マネキン等）は対象外
    if (!ids.has(c.id)) missing.push(c.name);
  }
  assert.deepEqual(missing, []);
});

test('旅人は全元素（氷を含む）を収録', () => {
  const els = new Set(Object.entries(db.characters).filter(([k]) => k.startsWith('10000005-')).map(([, c]) => c.element));
  for (const el of ['pyro', 'hydro', 'anemo', 'geo', 'electro', 'dendro', 'cryo']) assert.ok(els.has(el), el);
});

test('Enka の辞書に無い新キャラはスキルIDの並びから天賦レベルを推定する', () => {
  assert.deepEqual(guessSkillOrder({ 11255: 10, 11251: 6, 11252: 10 }), [11251, 11252, 11255]);
  assert.deepEqual(guessSkillOrder({ 1: 1, 2: 1, 3: 1, 9: 1 }), [1, 2, 9]);
  assert.deepEqual(guessExtraLevels({ 12532: 3, 12539: 3 }), { normal: 0, skill: 3, burst: 3 });

  const key = Object.keys(db.characters).find((k) => db.characters[k].skillOrder === null);
  if (!key) return; // すべて Enka 辞書にある場合は対象なし
  const copy = structuredClone(sample);
  const info = copy.avatarInfoList[0];
  info.avatarId = Number(key);
  info.skillDepotId = 1;
  info.skillLevelMap = { 99001: 7, 99002: 9, 99005: 10 };
  info.proudSkillExtraLevelMap = { 99032: 3 };
  const c = parseEnkaResponse(copy, db).characters[0];
  assert.equal(c.supported, true);
  assert.deepEqual(c.talentLevels, { normal: 7, skill: 12, burst: 10 });
});

test('月反応・星反応のダメージ行は概算フラグ付きで収録（通常ダメージ扱いの Lunar 行は除外しない）', () => {
  const flins = Object.values(db.characters).find((c) => c.key === 'Flins');
  assert.ok(flins.talents.burst.rows.some((r) => r.special === 'lunar'));
  const zibai = Object.values(db.characters).find((c) => c.key === 'Zibai');
  if (zibai) assert.ok(zibai.talents.skill.rows.some((r) => /Lunar Phase Shift 1-Hit/.test(r.nameEn) && !r.special));
});
