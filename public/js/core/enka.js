// Enka.Network API (https://enka.network/api/uid/{uid}) のレスポンスを、
// サイト内で扱う「ビルド」形式に正規化する。
import { APPEND_PROP, FIGHT_PROP, SLOT_ORDER } from './constants.js';

export function isValidUid(uid) {
  return /^(18|[1-9])\d{8}$/.test(String(uid).trim());
}

const num = (v) => (v == null ? 0 : Number(v));

function locName(loc, hash, lang = 'ja') {
  if (hash == null) return null;
  return loc?.[lang]?.[String(hash)] ?? null;
}

/** fightPropMap → パネルステータス（%系は小数: 0.5 = 50%） */
export function panelFromFightProps(fp) {
  const g = (id) => num(fp?.[id] ?? fp?.[String(id)]);
  return {
    baseHp: g(FIGHT_PROP.BASE_HP),
    baseAtk: g(FIGHT_PROP.BASE_ATK),
    baseDef: g(FIGHT_PROP.BASE_DEF),
    hp: g(FIGHT_PROP.HP),
    atk: g(FIGHT_PROP.ATK),
    def: g(FIGHT_PROP.DEF),
    em: g(FIGHT_PROP.EM),
    cr: g(FIGHT_PROP.CR),
    cd: g(FIGHT_PROP.CD),
    er: g(FIGHT_PROP.ER),
    heal: g(FIGHT_PROP.HEAL),
    dmg: {
      physical: g(FIGHT_PROP.PHYSICAL),
      pyro: g(FIGHT_PROP.PYRO),
      hydro: g(FIGHT_PROP.HYDRO),
      electro: g(FIGHT_PROP.ELECTRO),
      cryo: g(FIGHT_PROP.CRYO),
      anemo: g(FIGHT_PROP.ANEMO),
      geo: g(FIGHT_PROP.GEO),
      dendro: g(FIGHT_PROP.DENDRO),
    },
  };
}

function statOf(s) {
  // ドキュメント上は propValue だが、実際のレスポンスは statValue
  const prop = s.mainPropId ?? s.appendPropId;
  return { prop, key: APPEND_PROP[prop] ?? prop, value: num(s.statValue ?? s.propValue) };
}

function parseWeapon(equip, loc, meta) {
  const flat = equip.flat ?? {};
  const fb = meta?.weapons?.[equip.itemId];
  const stats = (flat.weaponStats ?? []).map(statOf);
  const base = stats.find((s) => s.prop === 'FIGHT_PROP_BASE_ATTACK');
  const sub = stats.find((s) => s.prop !== 'FIGHT_PROP_BASE_ATTACK') ?? null;
  const affix = Object.values(equip.weapon?.affixMap ?? {})[0];
  return {
    id: equip.itemId,
    nameJa: locName(loc, flat.nameTextMapHash, 'ja') ?? fb?.ja ?? `武器 ${equip.itemId}`,
    nameEn: locName(loc, flat.nameTextMapHash, 'en') ?? fb?.en ?? String(equip.itemId),
    icon: flat.icon ?? null,
    rarity: flat.rankLevel ?? null,
    level: equip.weapon?.level ?? 1,
    ascension: equip.weapon?.promoteLevel ?? 0,
    refinement: affix == null ? 1 : affix + 1,
    baseAtk: base?.value ?? 0,
    substat: sub,
  };
}

/** アイコン名 "UI_RelicIcon_15006_4" からセットIDを取り出す */
export function setIdFromIcon(icon) {
  const m = /RelicIcon_(\d+)_/.exec(icon ?? '');
  return m ? Number(m[1]) : null;
}

function parseArtifact(equip, loc, meta) {
  const flat = equip.flat ?? {};
  const fb = meta?.sets?.[setIdFromIcon(flat.icon)];
  return {
    slot: flat.equipType,
    setHash: flat.setNameTextMapHash ?? null,
    setNameJa: locName(loc, flat.setNameTextMapHash, 'ja') ?? fb?.ja ?? '不明なセット',
    setNameEn: locName(loc, flat.setNameTextMapHash, 'en') ?? fb?.en ?? '',
    nameJa: locName(loc, flat.nameTextMapHash, 'ja') ?? '',
    icon: flat.icon ?? null,
    rarity: flat.rankLevel ?? null,
    // reliquary.level は 1〜21（+0〜+20）
    level: Math.max(0, (equip.reliquary?.level ?? 1) - 1),
    main: flat.reliquaryMainstat ? statOf(flat.reliquaryMainstat) : null,
    subs: (flat.reliquarySubstats ?? []).map(statOf),
  };
}

/** セット名(英語) → 装備数 */
export function countSets(artifacts) {
  const sets = {};
  for (const a of artifacts) {
    const key = a.setNameEn || a.setNameJa;
    if (!key) continue;
    sets[key] = (sets[key] ?? 0) + 1;
  }
  return sets;
}

function resolveCharKey(info, characters) {
  const withDepot = `${info.avatarId}-${info.skillDepotId}`;
  if (characters[withDepot]) return withDepot;
  if (characters[String(info.avatarId)]) return String(info.avatarId);
  return null;
}

/**
 * avatarInfoList の1要素を正規化
 * @param {object} info
 * @param {{characters:object, loc:object, meta?:object}} db
 */
export function parseAvatar(info, db, uid = null) {
  const charKey = resolveCharKey(info, db.characters);
  const charData = charKey ? db.characters[charKey] : null;
  const prop = (id) => num(info.propMap?.[id]?.val ?? info.propMap?.[id]?.ival);

  const equips = info.equipList ?? [];
  const weaponEquip = equips.find((e) => e.flat?.itemType === 'ITEM_WEAPON' || e.weapon);
  const artifacts = equips
    .filter((e) => e.flat?.itemType === 'ITEM_RELIQUARY' || e.reliquary)
    .map((e) => parseArtifact(e, db.loc, db.meta))
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

  // 天賦レベル: 基本レベル + 命ノ星座などによる追加レベル
  const talentLevels = {};
  const talentBase = {};
  if (charData) {
    ['normal', 'skill', 'burst'].forEach((t, i) => {
      const skillId = charData.skillOrder[i];
      const base = num(info.skillLevelMap?.[skillId]) || 1;
      const proud = charData.proudMap?.[skillId];
      const extra = proud != null ? num(info.proudSkillExtraLevelMap?.[proud]) : 0;
      talentBase[t] = base;
      talentLevels[t] = Math.min(15, base + extra);
    });
  }

  return {
    uid,
    avatarId: info.avatarId,
    charKey,
    supported: !!charData,
    nameJa: charData?.nameJa ?? `キャラ ${info.avatarId}`,
    element: charData?.element ?? null,
    weaponType: charData?.weaponType ?? null,
    icon: charData?.icon ?? null,
    level: prop(4001) || 1,
    ascension: prop(1002),
    constellation: (info.talentIdList ?? []).length,
    friendship: info.fetterInfo?.expLevel ?? null,
    talentLevels,
    talentBase,
    weapon: weaponEquip ? parseWeapon(weaponEquip, db.loc, db.meta) : null,
    artifacts,
    sets: countSets(artifacts),
    panel: panelFromFightProps(info.fightPropMap),
    fetchedAt: new Date().toISOString(),
  };
}

/** Enka のレスポンス全体を正規化 */
export function parseEnkaResponse(json, db) {
  const p = json.playerInfo ?? {};
  const uid = json.uid ?? null;
  return {
    uid,
    player: {
      nickname: p.nickname ?? '',
      level: p.level ?? null,
      worldLevel: p.worldLevel ?? null,
      signature: p.signature ?? '',
      showcaseCount: (p.showAvatarInfoList ?? []).length,
    },
    ttl: json.ttl ?? null,
    characters: (json.avatarInfoList ?? []).map((a) => parseAvatar(a, db, uid)),
  };
}

export const ENKA_ERRORS = {
  400: 'UIDの形式が正しくありません。',
  404: 'プレイヤーが見つかりません。UIDを確認してください。',
  424: 'ゲームのメンテナンス中、またはアップデート直後のためデータを取得できません。',
  429: 'リクエストが多すぎます。少し時間をおいて再度お試しください。',
  500: 'Enka.Network 側でエラーが発生しました。',
  503: 'Enka.Network が一時的に利用できません。',
};
