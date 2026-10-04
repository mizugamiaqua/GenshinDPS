// テスト用の Enka レスポンス（実データ形式に準拠したサンプル）を生成する
import { writeFileSync } from 'node:fs';

const relic = (slot, setHash, setId, main, subs, n) => ({
  itemId: 90000 + n,
  reliquary: { level: 21, mainPropId: 10001, appendPropIdList: [501064, 501204, 501224, 501234] },
  flat: {
    nameTextMapHash: '0',
    setNameTextMapHash: setHash,
    rankLevel: 5,
    reliquaryMainstat: { mainPropId: main[0], statValue: main[1] },
    reliquarySubstats: subs.map(([appendPropId, statValue]) => ({ appendPropId, statValue })),
    itemType: 'ITEM_RELIQUARY',
    icon: `UI_RelicIcon_${setId}_${n}`,
    equipType: slot,
  },
});

const huTao = {
  avatarId: 10000046,
  propMap: { 4001: { type: 4001, ival: '90', val: '90' }, 1002: { type: 1002, ival: '6', val: '6' } },
  talentIdList: [461, 462, 463],
  fightPropMap: {
    1: 15552.3, 2: 4780, 3: 0.466, 4: 714.5, 5: 311, 6: 0, 7: 876.2, 8: 0, 9: 0,
    20: 0.68, 22: 2.25, 23: 1.11, 26: 0, 28: 140, 30: 0, 40: 0.616, 41: 0, 42: 0, 43: 0, 44: 0, 45: 0, 46: 0,
    2000: 35210, 2001: 1312, 2002: 952,
  },
  skillDepotId: 4601,
  skillLevelMap: { 10461: 10, 10462: 10, 10463: 9 },
  proudSkillExtraLevelMap: { 4632: 3 },
  equipList: [
    {
      itemId: 13501,
      weapon: { level: 90, promoteLevel: 6, affixMap: { 113501: 0 } },
      flat: {
        nameTextMapHash: '3235324891', rankLevel: 5, itemType: 'ITEM_WEAPON', icon: 'UI_EquipIcon_Pole_Homa',
        weaponStats: [
          { appendPropId: 'FIGHT_PROP_BASE_ATTACK', statValue: 608 },
          { appendPropId: 'FIGHT_PROP_CRITICAL_HURT', statValue: 66.2 },
        ],
      },
    },
    relic('EQUIP_BRACER', '1524173875', 15006, ['FIGHT_PROP_HP', 4780], [['FIGHT_PROP_CRITICAL', 10.5], ['FIGHT_PROP_CRITICAL_HURT', 21.0], ['FIGHT_PROP_ELEMENT_MASTERY', 40], ['FIGHT_PROP_HP_PERCENT', 5.8]], 4),
    relic('EQUIP_NECKLACE', '1524173875', 15006, ['FIGHT_PROP_ATTACK', 311], [['FIGHT_PROP_CRITICAL', 7.0], ['FIGHT_PROP_CRITICAL_HURT', 20.2], ['FIGHT_PROP_HP_PERCENT', 9.9], ['FIGHT_PROP_HP', 299]], 2),
    relic('EQUIP_SHOES', '1524173875', 15006, ['FIGHT_PROP_HP_PERCENT', 46.6], [['FIGHT_PROP_CRITICAL', 6.6], ['FIGHT_PROP_CRITICAL_HURT', 13.2], ['FIGHT_PROP_ELEMENT_MASTERY', 42], ['FIGHT_PROP_ATTACK', 33]], 5),
    relic('EQUIP_RING', '1524173875', 15006, ['FIGHT_PROP_FIRE_ADD_HURT', 46.6], [['FIGHT_PROP_CRITICAL', 9.7], ['FIGHT_PROP_CRITICAL_HURT', 14.0], ['FIGHT_PROP_HP_PERCENT', 4.7], ['FIGHT_PROP_CHARGE_EFFICIENCY', 11.0]], 1),
    relic('EQUIP_DRESS', '1212345779', 15001, ['FIGHT_PROP_CRITICAL', 31.1], [['FIGHT_PROP_CRITICAL_HURT', 27.2], ['FIGHT_PROP_HP_PERCENT', 10.5], ['FIGHT_PROP_ELEMENT_MASTERY', 58], ['FIGHT_PROP_DEFENSE', 23]], 3),
  ],
  fetterInfo: { expLevel: 10 },
};

const raiden = {
  avatarId: 10000052,
  propMap: { 4001: { type: 4001, ival: '90', val: '90' }, 1002: { type: 1002, ival: '6', val: '6' } },
  talentIdList: [521, 522],
  fightPropMap: {
    1: 12907, 4: 945.2, 7: 789, 20: 0.62, 22: 1.38, 23: 2.62, 28: 0, 30: 0, 41: 0.466,
    2000: 19800, 2001: 2100, 2002: 940,
  },
  skillDepotId: 5201,
  skillLevelMap: { 10521: 6, 10522: 9, 10525: 10 },
  proudSkillExtraLevelMap: {},
  equipList: [
    {
      itemId: 13509,
      weapon: { level: 90, promoteLevel: 6, affixMap: { 113509: 0 } },
      flat: {
        nameTextMapHash: '3717849275', rankLevel: 5, itemType: 'ITEM_WEAPON', icon: 'UI_EquipIcon_Pole_Narukami',
        weaponStats: [
          { appendPropId: 'FIGHT_PROP_BASE_ATTACK', statValue: 608 },
          { appendPropId: 'FIGHT_PROP_CHARGE_EFFICIENCY', statValue: 55.1 },
        ],
      },
    },
    ...['EQUIP_BRACER', 'EQUIP_NECKLACE', 'EQUIP_SHOES', 'EQUIP_RING', 'EQUIP_DRESS'].map((slot, i) =>
      relic(slot, '2276480763', 15020, ['FIGHT_PROP_HP', 4780], [['FIGHT_PROP_CRITICAL', 7.0], ['FIGHT_PROP_CRITICAL_HURT', 14.0]], i + 1)),
  ],
  fetterInfo: { expLevel: 10 },
};

const response = {
  playerInfo: {
    nickname: 'テスト旅人', level: 60, signature: 'sample', worldLevel: 9, namecardId: 210001,
    finishAchievementNum: 900, towerFloorIndex: 12, towerLevelIndex: 3,
    showAvatarInfoList: [{ avatarId: 10000046, level: 90 }, { avatarId: 10000052, level: 90 }],
  },
  avatarInfoList: [huTao, raiden],
  ttl: 60,
  uid: '800000001',
};

writeFileSync(new URL('../test/fixtures/enka-sample.json', import.meta.url), JSON.stringify(response, null, 2));
console.log('wrote test/fixtures/enka-sample.json');
