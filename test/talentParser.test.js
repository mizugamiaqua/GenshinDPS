import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplate, parseTalent, variantSuffixes } from '../public/js/core/talentParser.js';
import { charByName, db } from './helpers.js';

test('単純な倍率', () => {
  const r = parseTemplate('{param1:F1P}');
  assert.equal(r.variants.length, 1);
  assert.deepEqual(r.variants[0][0], { param: 'param1', percent: true, stat: 'atk', element: null, count: 1, unsupported: false });
});

test('複数ヒット・回数表記', () => {
  const r = parseTemplate('{param5:F1P}+{param6:F1P}');
  assert.equal(r.variants[0].length, 2);
  const x = parseTemplate('{param1:F1P}×3');
  assert.equal(x.variants[0][0].count, 3);
  const y = parseTemplate('{param1:F1P}*4');
  assert.equal(y.variants[0][0].count, 4);
});

test('参照ステータス（HP・防御・熟知）', () => {
  assert.equal(parseTemplate('{param1:F2P} Max HP').variants[0][0].stat, 'hp');
  assert.equal(parseTemplate('{param1:F1P} DEF').variants[0][0].stat, 'def');
  const am = parseTemplate('{param1:F1P} ATK+{param2:F1P} Elemental Mastery').variants[0];
  assert.deepEqual(am.map((h) => h.stat), ['atk', 'em']);
  // 右側の項からステータスを引き継ぐ
  assert.deepEqual(parseTemplate('{param1:F1P}+{param2:F1P} DEF').variants[0].map((h) => h.stat), ['def', 'def']);
});

test('グループ回数 (A+B)×2', () => {
  const r = parseTemplate('({param1:F1P} ATK+{param2:F1P} Elemental Mastery)×2');
  assert.deepEqual(r.variants[0].map((h) => h.count), [2, 2]);
});

test('低空/高空などのバリエーション', () => {
  const r = parseTemplate('{param11:P}/{param12:P}');
  assert.equal(r.variants.length, 2);
  assert.deepEqual(variantSuffixes('Low/High Plunge DMG', 2), ['Low', 'High']);
  assert.deepEqual(variantSuffixes('低空/高空落下攻撃ダメージ', 2), ['低空', '高空']);
});

test('単位付き（/s, /Stack）はダメージ行として扱わない', () => {
  assert.equal(parseTemplate('{param1:F1P}/s').hasUnit, true);
  assert.equal(parseTemplate('{param1:F1}s').hasUnit, true);
});

test('胡桃の天賦を解析できる', () => {
  const hu = charByName('Hu Tao');
  const normal = hu.talents.normal.rows;
  assert.ok(normal.some((r) => r.nameEn === 'Charged Attack' && r.category === 'charged'));
  assert.ok(normal.some((r) => r.nameEn === 'Low/High Plunge DMG [High]' && r.category === 'plunge'));
  const five = normal.find((r) => r.nameEn === '5-Hit DMG');
  assert.equal(five.hits.length, 2);
  assert.equal(hu.talents.skill.cooldown[0], 16);
  assert.equal(hu.talents.burst.energyCost, 60);
  assert.ok(hu.talents.skill.extras.some((e) => e.nameEn === 'ATK Increase'));
});

test('全キャラで最低1つはダメージ行がある', () => {
  for (const [key, c] of Object.entries(db.characters)) {
    const n = c.talents.normal.rows.length + c.talents.skill.rows.length + c.talents.burst.rows.length;
    assert.ok(n > 0, `${key} ${c.nameJa}`);
    for (const t of ['normal', 'skill', 'burst']) {
      for (const r of c.talents[t].rows) {
        for (const h of r.hits) assert.ok(h.values.length >= 10 && h.values.every(Number.isFinite), `${c.nameJa} ${r.nameJa}`);
      }
    }
  }
});

test('parseTalent: ヒール行などは除外し、補助値として保存', () => {
  const en = { name: 'X', attributes: { labels: ['Skill DMG|{param1:F1P}', 'Healing|{param2:F1P} Max HP+{param3:I}', 'CD|{param4:F1}s'], parameters: { param1: [1, 2], param2: [0.1, 0.2], param3: [100, 200], param4: [12, 12] } } };
  const t = parseTalent('skill', en, null);
  assert.equal(t.rows.length, 1);
  assert.deepEqual(t.cooldown, [12, 12]);
  assert.ok(t.extras.some((e) => e.nameEn === 'Healing'));
});
