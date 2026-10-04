import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnkaResponse } from '../public/js/core/enka.js';
import { createEngine } from '../public/js/core/engine.js';
import { evaluateCombo, recommendCombo } from '../public/js/core/rotation.js';
import { db, sample } from './helpers.js';

const parsed = parseEnkaResponse(sample, db);
const huBuild = parsed.characters[0];
const raidenBuild = parsed.characters[1];
const engineFor = (build, settings = {}) => createEngine(db.characters[build.charKey], build, settings);

test('胡桃: 元素スキルのHP→攻撃力変換と元素付与', () => {
  const e = engineFor(huBuild);
  const cap = 4 * huBuild.panel.baseAtk;
  const conv = Math.min(huBuild.panel.hp * e.ctx.talentValue('skill', /^ATK Increase$/), cap);
  assert.ok(conv > 0);
  assert.ok(Math.abs(e.stats.atk - (huBuild.panel.atk + conv)) < 1e-6);
  // 3凸でスキルLv13の値を使う
  assert.equal(e.ctx.talentLevels.skill, 13);
  // 元素付与により通常攻撃は炎
  const n1 = e.actions.find((a) => a.id === 'normal:0:0');
  assert.equal(n1.hits[0].element, 'pyro');
  // 炎魔女4セットが検出されている
  assert.ok(e.buffs.some((b) => b.def.id === 'set:cw' && b.on));
});

test('バフをOFFにするとダメージが下がる', () => {
  const on = engineFor(huBuild);
  const off = engineFor(huBuild, { buffs: { 'profile:hutao:e': { on: false } } });
  assert.ok(on.damageOf('normal:6:0').avg > off.damageOf('normal:6:0').avg);
});

test('チームバフは既定でOFF、ONにすると反映される', () => {
  const base = engineFor(huBuild);
  assert.equal(base.buffs.find((b) => b.def.id === 'team:zhongli').on, false);
  const z = engineFor(huBuild, { buffs: { 'team:zhongli': { on: true } } });
  assert.ok(z.damageOf('normal:6:0').avg > base.damageOf('normal:6:0').avg);
});

test('コンボ評価: 合計・時間・DPS', () => {
  const e = engineFor(huBuild);
  const combo = { entries: [
    { actionId: 'normal:0:0', count: 2 },
    { actionId: 'normal:6:0', count: 2, time: 0.6 },
  ] };
  const r = evaluateCombo(e, combo);
  const expect = 2 * e.damageOf('normal:0:0').avg + 2 * e.damageOf('normal:6:0').avg;
  assert.ok(Math.abs(r.totalDamage - expect) < 1e-6);
  assert.ok(Math.abs(r.totalTime - (2 * 0.4 + 2 * 0.6)) < 1e-9);
  assert.ok(Math.abs(r.dps - expect / r.totalTime) < 1e-6);
  // ローテーション時間を指定するとそれで割る
  const r2 = evaluateCombo(e, { ...combo, duration: 10 });
  assert.ok(Math.abs(r2.dps - expect / 10) < 1e-6);
});

test('反応設定: 全体の蒸発設定と個別のなし指定', () => {
  const e = engineFor(huBuild, { reaction: { type: 'vaporize', rate: 100 } });
  const plain = engineFor(huBuild);
  assert.ok(e.damageOf('normal:6:0').avg > plain.damageOf('normal:6:0').avg * 1.4);
  assert.ok(Math.abs(e.damageOf('normal:6:0', 'none').avg - plain.damageOf('normal:6:0').avg) < 1e-6);
});

test('推奨コンボ: 胡桃は E → 通常1段+重撃 → 低HP爆発', () => {
  const e = engineFor(huBuild);
  const rec = recommendCombo(e);
  const ids = rec.combo.entries.map((x) => x.actionId);
  assert.ok(ids.includes('cast:skill'));
  assert.ok(ids.includes('normal:0:0'));
  assert.ok(ids.includes('normal:6:0'));
  // 爆発は「低HP時」を選ぶ（通常時との択一）
  assert.ok(ids.includes('burst:1:0'));
  assert.ok(!ids.includes('burst:0:0'));
  const r = evaluateCombo(e, rec.combo);
  assert.ok(r.dps > 0);
  assert.ok(rec.notes.length > 0);
});

test('推奨コンボ: 雷電は夢想の一心中の攻撃と2凸防御無視', () => {
  const e = engineFor(raidenBuild);
  assert.equal(raidenBuild.constellation, 2);
  assert.ok(e.buffs.some((b) => b.def.id === 'profile:raiden:c2'));
  const rec = recommendCombo(e);
  const ids = rec.combo.entries.map((x) => x.actionId);
  assert.ok(ids.includes('burst:0:0'), '夢想の一太刀');
  assert.ok(ids.some((id) => /^burst:[3-8]:0$/.test(id)), '夢想の一心中の攻撃');
  assert.ok(!ids.some((id) => id.startsWith('normal:')), '通常の物理攻撃は使わない');
  // 願力スタックで夢想の一太刀が強化される
  const noStacks = engineFor(raidenBuild, { buffs: { 'profile:raiden:resolve': { on: true, params: { stacks: 0 } } } });
  assert.ok(e.damageOf('burst:0:0').avg > noStacks.damageOf('burst:0:0').avg);
});

test('全キャラで推奨コンボが生成でき、DPSが有限値になる', () => {
  const template = huBuild;
  for (const [key, c] of Object.entries(db.characters)) {
    const build = { ...template, charKey: key, talentLevels: { normal: 9, skill: 9, burst: 9 }, constellation: 0, sets: {} };
    const e = createEngine(c, build, {});
    const rec = recommendCombo(e);
    const r = evaluateCombo(e, rec.combo);
    assert.ok(Number.isFinite(r.dps) && r.dps >= 0, `${key} ${c.nameJa}`);
    assert.ok(rec.combo.entries.length > 0, `${key} ${c.nameJa}`);
  }
});

test('推奨コンボのタイムライン: 胡桃は E → 通常1段+重撃 → 最後に爆発、同じパターンはまとめる', () => {
  const e = engineFor(huBuild);
  const rec = recommendCombo(e);
  assert.ok(rec.timeline[0].label.startsWith('元素スキル'));
  assert.ok(rec.timeline[rec.timeline.length - 1].label.startsWith('元素爆発'));
  const attacks = rec.timeline.filter((s) => s.kind === 'attack');
  assert.equal(attacks.length, 1);
  assert.match(attacks[0].label, /×\d+/);
  for (let i = 1; i < rec.timeline.length; i++) assert.ok(rec.timeline[i].start >= rec.timeline[i - 1].start);
});

test('fieldBudget を超えない', () => {
  for (const build of [huBuild, raidenBuild]) {
    const e = engineFor(build);
    const rec = recommendCombo(e, { role: 'main', fieldBudget: 8 });
    const r = evaluateCombo(e, { ...rec.combo, duration: null });
    assert.ok(r.totalTime <= 8 + 1.7, `${build.nameJa}: ${r.totalTime}`); // 爆発・スキル1回分の超過は許容
  }
});
