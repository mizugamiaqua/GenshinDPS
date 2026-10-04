import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnkaResponse } from '../public/js/core/enka.js';
import { createTeam, evaluateTeam, recommendTeam, teamLinkBuffs } from '../public/js/core/team.js';
import { createEngine } from '../public/js/core/engine.js';
import { charByName, db, sample } from './helpers.js';

const template = parseEnkaResponse(sample, db).characters[0]; // 胡桃のビルドを雛形にする
const keyOf = (name) => Object.keys(db.characters).find((k) => db.characters[k].key === name);
function member(name, patch = {}) {
  const charData = charByName(name);
  const build = { ...template, charKey: keyOf(name), nameJa: charData.nameJa, element: charData.element, sets: {}, constellation: 0,
    talentLevels: { normal: 10, skill: 10, burst: 10 }, ...patch };
  return { id: `test:${name}`, charData, build, settings: {} };
}

const inputs = () => [member('Hu Tao', template), member('Bennett', { sets: { 'Noblesse Oblige': 4 } }), member('Xingqiu'), member('Zhongli')];

test('ベネットの攻撃力加算は本人の基礎攻撃力×爆発倍率で計算される', () => {
  const t = createTeam(inputs(), {});
  const ben = t.members[1];
  const link = t.links.find((l) => l.id === 'tl:Bennett:burst');
  assert.ok(link && link.on);
  const ratio = ben.engine.ctx.talentValue('burst', /^ATK Bonus Ratio$/);
  const expected = ben.engine.stats.baseAtk * ratio;
  assert.deepEqual(link.receivers, [0, 1, 2, 3]);
  // 胡桃の攻撃力にそのまま加算される（冥蝶の舞の変換とは別枠）
  const solo = createEngine(charByName('Hu Tao'), template, {}, { teamBuffs: [] });
  const hu = t.members[0].engine;
  assert.ok(Math.abs(hu.mods.atk - solo.mods.atk - expected) < 1e-6);
});

test('鍾離の耐性ダウン・炎元素共鳴・ベネットの旧貴族4（本人以外）', () => {
  const t = createTeam(inputs(), {});
  assert.ok(t.links.some((l) => l.id === 'tl:Zhongli:shield'));
  const reso = t.links.find((l) => l.id === 'tl:reso:pyro');
  assert.ok(reso, '炎2人で炎共鳴');
  const nob = t.links.find((l) => l.id.startsWith('tl:set:noblesse'));
  assert.deepEqual(nob.receivers, [0, 2, 3]);
  assert.equal(t.members[0].engine.mods['res.all'], 0.2);
});

test('チームバフをOFFにすると反映されない', () => {
  const on = createTeam(inputs(), {});
  const off = createTeam(inputs(), { buffs: { 'tl:Bennett:burst': { on: false } } });
  assert.ok(on.members[0].engine.stats.atk > off.members[0].engine.stats.atk);
});

test('手入力のチームバフはチーム編成時には使わない', () => {
  const m = member('Hu Tao', template);
  m.settings = { buffs: { 'team:zhongli': { on: true } } };
  const t = createTeam([m, member('Xingqiu')], {});
  assert.equal(t.members[0].engine.mods['res.all'], undefined);
  assert.ok(!t.members[0].engine.buffs.some((b) => b.def.id === 'team:zhongli'));
});

test('推奨チームローテ: メインは胡桃、サポートは通常攻撃をしない、時間内に収まる', () => {
  const t = createTeam(inputs(), { rotationLength: 20 });
  const rec = recommendTeam(t);
  assert.equal(rec.mainIndex, 0);
  for (const i of [1, 2, 3]) {
    assert.ok(!rec.combos[i].entries.some((e) => e.actionId.startsWith('normal:')), `メンバー${i}`);
  }
  // 行秋の雨すだれは持続ダメージとして複数回カウント
  const xq = t.members[2].engine.actions.find((a) => a.baseNameEn === 'Sword Rain DMG');
  assert.ok(rec.combos[2].entries.find((e) => e.actionId === xq.id).count > 10);
  const ev = evaluateTeam(createTeam(inputs(), { rotationLength: 20, combos: rec.combos }));
  assert.ok(!ev.overTime, `field ${ev.fieldTime}`);
  assert.ok(Math.abs(ev.rows.reduce((s, r) => s + r.damage, 0) - ev.totalDamage) < 1e-6);
  assert.ok(Math.abs(ev.dps - ev.totalDamage / 20) < 1e-6);
  assert.ok(ev.rows.every((r) => r.damage > 0));
});

test('メンバーが4人未満・空きスロットがあっても計算できる', () => {
  const t = createTeam([member('Hu Tao', template), null, member('Xingqiu'), null], {});
  assert.equal(t.members.length, 2);
  const ev = evaluateTeam(createTeam([member('Hu Tao', template), null, member('Xingqiu'), null], { combos: recommendTeam(t).combos }));
  assert.ok(ev.dps > 0);
});

test('どの4人を組んでも推奨チームローテが計算できる', () => {
  const keys = Object.values(db.characters).map((c) => c.key).filter((k, i, a) => a.indexOf(k) === i);
  for (let i = 0; i + 3 < keys.length; i += 4) {
    const ins = keys.slice(i, i + 4).map((k) => member(k));
    const t = createTeam(ins, {});
    teamLinkBuffs(t.members);
    const ev = evaluateTeam(createTeam(ins, { combos: recommendTeam(t).combos }));
    assert.ok(Number.isFinite(ev.dps) && ev.dps >= 0, keys.slice(i, i + 4).join(','));
  }
});

test('推奨チームローテの並び順: シールド → 控え → バッファー（メインの直前）→ メイン', () => {
  const ins = [member('Hu Tao', template), member('Bennett'), member('Zhongli'), member('Xingqiu')];
  const t = createTeam(ins, { rotationLength: 20 });
  const rec = recommendTeam(t, { mainIndex: 0 });
  assert.deepEqual(rec.order.map((o) => o.name), ['鍾離', '行秋', 'ベネット', '胡桃']);
  assert.deepEqual(rec.order.map((o) => o.role), ['shield', 'sub', 'buffer', 'main']);
  // 開始秒数は単調増加
  for (let i = 1; i < rec.order.length; i++) assert.ok(rec.order[i].start >= rec.order[i - 1].start);
});

test('控え役は特殊状態の攻撃をせず、元素スキルは1回（フリンズのCDをサブ技と取り違えない）', () => {
  const flins = charByName('Flins');
  assert.equal(flins.talents.skill.cooldown[9], 16);
  const ins = [member('Hu Tao', template), member('Flins'), member('Furina'), member('Yelan')];
  const t = createTeam(ins, { rotationLength: 20 });
  const rec = recommendTeam(t, { mainIndex: 0 });
  const fl = t.members[1].engine;
  const chainIds = new Set(fl.actions.filter((a) => a.kind === 'chain' || a.kind === 'charged').map((a) => a.id));
  assert.ok(!rec.combos[1].entries.some((e) => chainIds.has(e.actionId)), '控えのフリンズは攻撃しない');
  const fo = rec.order.find((o) => o.index === 1);
  assert.equal(fo.steps.filter((s) => s.startsWith('元素スキル')).length, 1);
});

test('メイン判定: 控えダメージ型（夜蘭・フリーナ）より、フィールドで伸びるキャラがメインになる', () => {
  const ins = [member('Yelan'), member('Furina'), member('Hu Tao', template), member('Xingqiu')];
  const t = createTeam(ins, { rotationLength: 20 });
  assert.equal(recommendTeam(t).mainIndex, 2);
});
