import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidUid, parseEnkaResponse, setIdFromIcon } from '../public/js/core/enka.js';
import { db, sample } from './helpers.js';

test('UIDの検証', () => {
  assert.ok(isValidUid('800000001'));
  assert.ok(isValidUid('1800000001'));
  assert.ok(!isValidUid('12345'));
  assert.ok(!isValidUid('abc'));
  assert.ok(!isValidUid('080000000'));
});

test('Enkaレスポンスを正規化できる', () => {
  const r = parseEnkaResponse(sample, db);
  assert.equal(r.uid, '800000001');
  assert.equal(r.player.nickname, 'テスト旅人');
  assert.equal(r.characters.length, 2);

  const hu = r.characters[0];
  assert.equal(hu.nameJa, '胡桃');
  assert.equal(hu.supported, true);
  assert.equal(hu.level, 90);
  assert.equal(hu.constellation, 3);
  // 3凸で元素スキル+3
  assert.deepEqual(hu.talentLevels, { normal: 10, skill: 13, burst: 9 });
  assert.equal(hu.weapon.nameJa, '護摩の杖');
  assert.equal(hu.weapon.refinement, 1);
  assert.equal(hu.weapon.baseAtk, 608);
  assert.equal(hu.artifacts.length, 5);
  assert.equal(hu.artifacts[0].slot, 'EQUIP_BRACER');
  assert.equal(hu.artifacts[0].level, 20);
  assert.equal(hu.sets['Crimson Witch of Flames'], 4);
  assert.equal(hu.panel.hp, 35210);
  assert.equal(hu.panel.dmg.pyro, 0.616);
});

test('辞書に無いセット名はアイコンIDから補完する', () => {
  assert.equal(setIdFromIcon('UI_RelicIcon_15006_4'), 15006);
  const copy = structuredClone(sample);
  copy.avatarInfoList[0].equipList[1].flat.setNameTextMapHash = '999';
  const hu = parseEnkaResponse(copy, db).characters[0];
  assert.equal(hu.artifacts[0].setNameEn, 'Crimson Witch of Flames');
  assert.equal(hu.artifacts[0].setNameJa, '燃え盛る炎の魔女');
});

test('未対応キャラは supported=false', () => {
  const copy = structuredClone(sample);
  copy.avatarInfoList[0].avatarId = 99999999;
  const c = parseEnkaResponse(copy, db).characters[0];
  assert.equal(c.supported, false);
});
