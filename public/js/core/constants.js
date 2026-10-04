export const ELEMENTS = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'geo', 'dendro'];
export const DAMAGE_TYPES = ['physical', ...ELEMENTS];
export const CATEGORIES = ['normal', 'charged', 'plunge', 'skill', 'burst'];

export const ELEMENT_JA = {
  physical: '物理', pyro: '炎', hydro: '水', electro: '雷', cryo: '氷', anemo: '風', geo: '岩', dendro: '草',
};
export const CATEGORY_JA = {
  normal: '通常攻撃', charged: '重撃', plunge: '落下攻撃', skill: '元素スキル', burst: '元素爆発',
};
export const WEAPON_JA = {
  WEAPON_SWORD_ONE_HAND: '片手剣', WEAPON_CLAYMORE: '両手剣', WEAPON_POLE: '長柄武器',
  WEAPON_CATALYST: '法器', WEAPON_BOW: '弓',
};

// Enka fightPropMap の ID
export const FIGHT_PROP = {
  BASE_HP: 1, BASE_ATK: 4, BASE_DEF: 7,
  CR: 20, CD: 22, ER: 23, HEAL: 26, EM: 28,
  PHYSICAL: 30, PYRO: 40, ELECTRO: 41, HYDRO: 42, DENDRO: 43, ANEMO: 44, GEO: 45, CRYO: 46,
  HP: 2000, ATK: 2001, DEF: 2002,
};

// 聖遺物・武器のサブステータス（appendPropId）→ 内部キー
export const APPEND_PROP = {
  FIGHT_PROP_HP: 'hp', FIGHT_PROP_ATTACK: 'atk', FIGHT_PROP_DEFENSE: 'def',
  FIGHT_PROP_HP_PERCENT: 'hp%', FIGHT_PROP_ATTACK_PERCENT: 'atk%', FIGHT_PROP_DEFENSE_PERCENT: 'def%',
  FIGHT_PROP_CRITICAL: 'cr', FIGHT_PROP_CRITICAL_HURT: 'cd', FIGHT_PROP_CHARGE_EFFICIENCY: 'er',
  FIGHT_PROP_HEAL_ADD: 'heal', FIGHT_PROP_ELEMENT_MASTERY: 'em',
  FIGHT_PROP_PHYSICAL_ADD_HURT: 'dmg.physical', FIGHT_PROP_FIRE_ADD_HURT: 'dmg.pyro',
  FIGHT_PROP_ELEC_ADD_HURT: 'dmg.electro', FIGHT_PROP_WATER_ADD_HURT: 'dmg.hydro',
  FIGHT_PROP_WIND_ADD_HURT: 'dmg.anemo', FIGHT_PROP_ICE_ADD_HURT: 'dmg.cryo',
  FIGHT_PROP_ROCK_ADD_HURT: 'dmg.geo', FIGHT_PROP_GRASS_ADD_HURT: 'dmg.dendro',
  FIGHT_PROP_BASE_ATTACK: 'baseAtk',
};

export const STAT_JA = {
  hp: 'HP', atk: '攻撃力', def: '防御力', 'hp%': 'HP%', 'atk%': '攻撃力%', 'def%': '防御力%',
  cr: '会心率', cd: '会心ダメージ', er: '元素チャージ効率', heal: '与える治療効果', em: '元素熟知',
  'dmg.physical': '物理ダメージ', 'dmg.pyro': '炎元素ダメージ', 'dmg.electro': '雷元素ダメージ',
  'dmg.hydro': '水元素ダメージ', 'dmg.anemo': '風元素ダメージ', 'dmg.cryo': '氷元素ダメージ',
  'dmg.geo': '岩元素ダメージ', 'dmg.dendro': '草元素ダメージ', baseAtk: '基礎攻撃力',
};

// 「%」で表示するステータス
export const PERCENT_STATS = new Set(['hp%', 'atk%', 'def%', 'cr', 'cd', 'er', 'heal',
  'dmg.physical', 'dmg.pyro', 'dmg.electro', 'dmg.hydro', 'dmg.anemo', 'dmg.cryo', 'dmg.geo', 'dmg.dendro']);

export const SLOT_ORDER = ['EQUIP_BRACER', 'EQUIP_NECKLACE', 'EQUIP_SHOES', 'EQUIP_RING', 'EQUIP_DRESS'];
export const SLOT_JA = {
  EQUIP_BRACER: '生の花', EQUIP_NECKLACE: '死の羽', EQUIP_SHOES: '時の砂', EQUIP_RING: '空の杯', EQUIP_DRESS: '理の冠',
};

// 激化・超激化・各種変化反応の基礎値（キャラLv別の係数）
// Lv1〜90 はゲーム内データ。Lv91 以降は暫定的に Lv89→90 の増分で外挿している。
const LEVEL_MULT_1_90 = [
  17.165606, 18.535048, 19.904854, 21.274902, 22.6454, 24.649612, 26.640642, 28.868587, 31.36768, 34.143345,
  37.201, 40.66, 44.446667, 48.56352, 53.74848, 59.081898, 64.420044, 69.72446, 75.12314, 80.58478,
  86.11203, 91.70374, 97.24463, 102.812645, 108.40956, 113.20169, 118.102905, 122.97932, 129.72733, 136.29291,
  142.67085, 149.02902, 155.41699, 161.8255, 169.10631, 176.51808, 184.07274, 191.70952, 199.55692, 207.38205,
  215.3989, 224.16566, 233.50217, 243.35057, 256.06308, 268.5435, 281.52606, 295.01364, 309.0672, 323.6016,
  336.75754, 350.5303, 364.48297, 378.61908, 398.6004, 416.39825, 434.387, 452.95105, 472.60623, 492.8849,
  513.56854, 539.1032, 565.51056, 592.53876, 624.4434, 651.47015, 679.4968, 707.79407, 736.67145, 765.64026,
  794.7734, 824.67737, 851.1578, 877.74207, 914.2291, 946.74677, 979.4114, 1011.223, 1044.7917, 1077.4437,
  1109.9976, 1142.9766, 1176.3695, 1210.1844, 1253.8357, 1288.9528, 1325.4841, 1363.4569, 1405.0974, 1446.8535,
];

export function levelMultiplier(level) {
  const lv = Math.max(1, Math.round(level));
  if (lv <= 90) return LEVEL_MULT_1_90[lv - 1];
  const step = LEVEL_MULT_1_90[89] - LEVEL_MULT_1_90[88];
  return LEVEL_MULT_1_90[89] + step * (lv - 90);
}

// フレームデータが無いキャラ用の、武器種ごとの目安モーション時間（秒）
export const WEAPON_TIMING = {
  WEAPON_SWORD_ONE_HAND: { hit: 0.42, charged: 0.75 },
  WEAPON_CLAYMORE: { hit: 0.62, charged: 0.6 },
  WEAPON_POLE: { hit: 0.4, charged: 0.85 },
  WEAPON_CATALYST: { hit: 0.5, charged: 1.25 },
  WEAPON_BOW: { hit: 0.42, charged: 1.6 },
};
export const ACTION_TIMING = { plunge: 1.0, skillPress: 0.6, skillHold: 1.3, burst: 1.6 };
