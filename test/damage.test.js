import { test } from 'node:test';
import assert from 'node:assert/strict';
import { additiveBonus, ampMultiplier, calcHit, computeStats, defMultiplier, resMultiplier } from '../public/js/core/damage.js';
import { levelMultiplier } from '../public/js/core/constants.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('耐性補正', () => {
  close(resMultiplier(0.1), 0.9);
  close(resMultiplier(-0.2), 1.1);
  close(resMultiplier(0.8), 1 / 4.2);
});

test('防御補正', () => {
  close(defMultiplier(90, 100), 190 / 390);
  close(defMultiplier(90, 90), 0.5);
  close(defMultiplier(90, 100, 0, 0.6), 190 / (190 + 200 * 0.4));
});

test('増幅反応・激化', () => {
  close(ampMultiplier('vaporize', 'pyro', 0), 1.5);
  close(ampMultiplier('vaporize', 'hydro', 0), 2.0);
  close(ampMultiplier('melt', 'pyro', 0, 0.15), 2.0 * 1.15);
  close(ampMultiplier('vaporize', 'electro', 500), 1);
  close(levelMultiplier(90), 1446.8535);
  close(additiveBonus('aggravate', 'electro', 0, 90), 1.15 * 1446.8535);
  close(additiveBonus('spread', 'dendro', 0, 90), 1.25 * 1446.8535);
});

const panel = {
  baseHp: 10000, baseAtk: 1000, baseDef: 700, hp: 20000, atk: 2000, def: 800, em: 0, cr: 0.5, cd: 1.0, er: 1, heal: 0,
  dmg: { physical: 0, pyro: 0.5, hydro: 0, electro: 0.5, cryo: 0, anemo: 0, geo: 0, dendro: 0 },
};

test('ステータス計算（攻撃力%は基礎攻撃力に掛かる）', () => {
  const s = computeStats(panel, { 'atk%': 0.2, atk: 100, 'dmg.pyro': 0.1 });
  close(s.atk, 2000 + 200 + 100);
  close(s.dmg.pyro, 0.6);
});

test('1ヒットのダメージ（手計算と一致）', () => {
  const stats = computeStats(panel, {});
  const env = { stats, mods: {}, level: 90, enemy: { level: 100, baseRes: 0.1 } };
  const r = calcHit({ stat: 'atk', mult: 1, count: 1, element: 'pyro', category: 'skill' }, env);
  const nonCrit = 2000 * 1.5 * (190 / 390) * 0.9;
  close(r.nonCrit, nonCrit);
  close(r.crit, nonCrit * 2);
  close(r.avg, nonCrit * 1.5);

  const v = calcHit({ stat: 'atk', mult: 1, count: 2, element: 'pyro', category: 'skill', reaction: { type: 'vaporize', rate: 1 } }, env);
  close(v.avg, nonCrit * 1.5 * 1.5 * 2);

  const half = calcHit({ stat: 'atk', mult: 1, count: 1, element: 'pyro', category: 'skill', reaction: { type: 'vaporize', rate: 0.5 } }, env);
  close(half.avg, nonCrit * 1.5 * 1.25);

  const ag = calcHit({ stat: 'atk', mult: 1, count: 1, element: 'electro', category: 'skill', reaction: { type: 'aggravate', rate: 1 } }, env);
  close(ag.nonCrit, (2000 + 1.15 * 1446.8535) * 1.5 * (190 / 390) * 0.9);
});

test('耐性ダウン・カテゴリバフ・会心率上限', () => {
  const stats = computeStats({ ...panel, cr: 1.2 }, {});
  const mods = { 'res.pyro': 0.3, 'dmg.normal': 0.5 };
  const env = { stats, mods, level: 90, enemy: { level: 100, baseRes: 0.1 } };
  const r = calcHit({ stat: 'atk', mult: 1, count: 1, element: 'pyro', category: 'normal' }, env);
  const nonCrit = 2000 * 2.0 * (190 / 390) * 1.1;
  close(r.nonCrit, nonCrit);
  close(r.avg, nonCrit * 2); // 会心率は100%で頭打ち
});
