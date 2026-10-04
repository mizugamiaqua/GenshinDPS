// バフ定義（聖遺物セット効果・チームバフ・カスタム）と集計。
//
// 効果(effects)は「キー → 加算値」のマップで表す。%系は小数（0.2 = 20%）。
//   atk% / atk / hp% / hp / def% / def / em / cr / cd / er
//   dmg（全ダメージ）, dmg.<元素|物理>, dmg.<normal|charged|plunge|skill|burst>
//   cr.<カテゴリ>, cd.<カテゴリ>
//   res.<元素|物理|all>（耐性ダウン量）, defRed（防御力ダウン）, defIgnore（防御無視）
//   react.<vaporize|melt|aggravate|spread>（反応ダメージボーナス）
//   flat.<カテゴリ|元素|all>（ダメージ基礎値への加算）
//
// effects(p, ctx) は静的効果、dynamic(p, stats, ctx) はステータス確定後に計算する効果
// （元素チャージ効率→爆発ダメージ、HP→攻撃力 など）。
import { ELEMENTS } from './constants.js';

const MELEE = new Set(['WEAPON_SWORD_ONE_HAND', 'WEAPON_CLAYMORE', 'WEAPON_POLE']);
const RANGED = new Set(['WEAPON_CATALYST', 'WEAPON_BOW']);

const toggle = (key, label, def = true) => ({ key, label, type: 'toggle', default: def });
const number = (key, label, def, opts = {}) => ({ key, label, type: 'number', default: def, ...opts });
const select = (key, label, def, options) => ({ key, label, type: 'select', default: def, options });

const ELEMENT_OPTIONS = [
  ['self', '自身の元素'], ['pyro', '炎'], ['hydro', '水'], ['electro', '雷'], ['cryo', '氷'],
  ['anemo', '風'], ['geo', '岩'], ['dendro', '草'], ['physical', '物理'],
];
const resolveElement = (v, ctx) => (v === 'self' ? ctx.element : v);

// ---------------------------------------------------------------------------
// 聖遺物セット（キーは英語セット名）
// 2セット効果のうちパネルに反映されないもの（爆発ダメージ+20% など）は need:2 で定義する
// ---------------------------------------------------------------------------
export const ARTIFACT_SETS = [
  // --- 2セット（パネル外のカテゴリバフ） ---
  { id: 'set:noblesse2', set: 'Noblesse Oblige', need: 2, label: '旧貴族のしつけ 2: 元素爆発ダメージ+20%',
    effects: () => ({ 'dmg.burst': 0.2 }) },
  { id: 'set:troupe2', set: 'Golden Troupe', need: 2, label: '黄金の劇団 2: 元素スキルダメージ+20%',
    effects: () => ({ 'dmg.skill': 0.2 }) },
  { id: 'set:mh2', set: 'Marechaussee Hunter', need: 2, label: 'ファントムハンター 2: 通常・重撃ダメージ+15%',
    effects: () => ({ 'dmg.normal': 0.15, 'dmg.charged': 0.15 }) },
  { id: 'set:lno2', set: "Long Night's Oath", need: 2, label: '長き夜の誓い 2: 落下攻撃ダメージ+25%',
    effects: () => ({ 'dmg.plunge': 0.25 }) },
  { id: 'set:codex2', set: 'Obsidian Codex', need: 2, label: '黒曜の秘典 2: 夜魂加護中ダメージ+15%', defaultOn: true,
    effects: () => ({ dmg: 0.15 }) },

  // --- 4セット ---
  { id: 'set:gladiator', set: "Gladiator's Finale", need: 4, label: '剣闘士のフィナーレ 4: 通常攻撃ダメージ+35%（片手剣/両手剣/長柄）',
    available: (ctx) => MELEE.has(ctx.weaponType), effects: () => ({ 'dmg.normal': 0.35 }) },
  { id: 'set:wanderer', set: "Wanderer's Troupe", need: 4, label: '大地を流浪する楽団 4: 重撃ダメージ+35%（法器/弓）',
    available: (ctx) => RANGED.has(ctx.weaponType), effects: () => ({ 'dmg.charged': 0.35 }) },
  { id: 'set:shimenawa', set: "Shimenawa's Reminiscence", need: 4, label: '追憶のしめ縄 4: 通常・重撃・落下ダメージ+50%',
    effects: () => ({ 'dmg.normal': 0.5, 'dmg.charged': 0.5, 'dmg.plunge': 0.5 }) },
  { id: 'set:cw', set: 'Crimson Witch of Flames', need: 4, label: '燃え盛る炎の魔女 4: 蒸発・溶解+15%、炎ダメージ+7.5%/スタック',
    params: [number('stacks', 'スキル使用スタック', 1, { min: 0, max: 3, step: 1 })],
    effects: (p) => ({ 'react.vaporize': 0.15, 'react.melt': 0.15, 'dmg.pyro': 0.075 * p.stacks }) },
  { id: 'set:emblem', set: 'Emblem of Severed Fate', need: 4, label: '絶縁の旗印 4: 元素チャージ効率の25%分、元素爆発ダメージアップ（最大75%）',
    dynamic: (p, s) => ({ 'dmg.burst': Math.min(0.25 * s.er, 0.75) }) },
  { id: 'set:noblesse4', set: 'Noblesse Oblige', need: 4, label: '旧貴族のしつけ 4: 元素爆発後 攻撃力+20%',
    effects: () => ({ 'atk%': 0.2 }) },
  { id: 'set:tom', set: 'Tenacity of the Millelith', need: 4, label: '千岩牢固 4: 元素スキル命中後 攻撃力+20%',
    effects: () => ({ 'atk%': 0.2 }) },
  { id: 'set:bs', set: 'Blizzard Strayer', need: 4, label: '氷風を彷徨う勇士 4: 会心率アップ',
    params: [select('state', '敵の状態', 'cryo', [['cryo', '氷元素付着（+20%）'], ['frozen', '凍結（+40%）'], ['none', 'なし']])],
    effects: (p) => ({ cr: { cryo: 0.2, frozen: 0.4, none: 0 }[p.state] ?? 0 }) },
  { id: 'set:hod', set: 'Heart of Depth', need: 4, label: '沈淪の心 4: スキル後 通常・重撃ダメージ+30%',
    effects: () => ({ 'dmg.normal': 0.3, 'dmg.charged': 0.3 }) },
  { id: 'set:tf', set: 'Thundering Fury', need: 4, label: '雷のような怒り 4: 超激化ボーナス+20%',
    effects: () => ({ 'react.aggravate': 0.2 }) },
  { id: 'set:thundersoother', set: 'Thundersoother', need: 4, label: '雷を鎮める尊者 4: 雷元素の影響を受けた敵へのダメージ+35%', defaultOn: false,
    effects: () => ({ dmg: 0.35 }) },
  { id: 'set:lavawalker', set: 'Lavawalker', need: 4, label: '烈火を渡る賢者 4: 炎元素の影響を受けた敵へのダメージ+35%', defaultOn: false,
    effects: () => ({ dmg: 0.35 }) },
  { id: 'set:paleflame', set: 'Pale Flame', need: 4, label: '蒼白の炎 4: 攻撃力+9%/スタック、2スタックで物理+25%',
    params: [number('stacks', 'スタック', 2, { min: 0, max: 2, step: 1 })],
    effects: (p) => ({ 'atk%': 0.09 * p.stacks, 'dmg.physical': p.stacks >= 2 ? 0.25 : 0 }) },
  { id: 'set:vermillion', set: 'Vermillion Hereafter', need: 4, label: '辰砂往生録 4: 攻撃力+8%、HP減少で+10%/スタック',
    params: [number('stacks', 'HP減少スタック', 4, { min: 0, max: 4, step: 1 })],
    effects: (p) => ({ 'atk%': 0.08 + 0.1 * p.stacks }) },
  { id: 'set:echoes', set: 'Echoes of an Offering', need: 4, label: '来歆の余響 4: 通常攻撃ダメージに攻撃力の70%を加算（発動率）',
    params: [number('rate', '発動率(%)', 50, { min: 0, max: 100, step: 1 })],
    dynamic: (p, s) => ({ 'flat.normal': 0.7 * s.atk * (p.rate / 100) }) },
  { id: 'set:husk', set: 'Husk of Opulent Dreams', need: 4, label: '華館夢醒形骸記 4: 防御力+6%・岩ダメージ+6%/スタック',
    params: [number('stacks', 'スタック', 4, { min: 0, max: 4, step: 1 })],
    effects: (p) => ({ 'def%': 0.06 * p.stacks, 'dmg.geo': 0.06 * p.stacks }) },
  { id: 'set:desert', set: 'Desert Pavilion Chronicle', need: 4, label: '砂上の楼閣の史話 4: 重撃命中後 通常・重撃・落下ダメージ+40%',
    effects: () => ({ 'dmg.normal': 0.4, 'dmg.charged': 0.4, 'dmg.plunge': 0.4 }) },
  { id: 'set:gilded', set: 'Gilded Dreams', need: 4, label: '金メッキの夢 4: 反応後 同元素1人につき攻撃力+14%、異元素1人につき熟知+50',
    params: [
      number('same', '同じ元素の味方', 0, { min: 0, max: 3, step: 1 }),
      number('diff', '異なる元素の味方', 3, { min: 0, max: 3, step: 1 }),
    ],
    effects: (p) => ({ 'atk%': 0.14 * p.same, em: 50 * p.diff }) },
  { id: 'set:deepwood', set: 'Deepwood Memories', need: 4, label: '深林の記憶 4: 草元素耐性-30%',
    effects: () => ({ 'res.dendro': 0.3 }) },
  { id: 'set:vv', set: 'Viridescent Venerer', need: 4, label: '翠緑の影 4: 拡散した元素の耐性-40%', defaultOn: false,
    params: [select('element', '耐性ダウン元素', 'pyro', ELEMENT_OPTIONS.filter(([k]) => ['pyro', 'hydro', 'electro', 'cryo'].includes(k)))],
    effects: (p) => ({ [`res.${p.element}`]: 0.4 }) },
  { id: 'set:troupe4', set: 'Golden Troupe', need: 4, label: '黄金の劇団 4: 元素スキルダメージ+25%（待機中さらに+25%）',
    params: [toggle('offField', '待機中（控え）', false)],
    effects: (p) => ({ 'dmg.skill': 0.25 + (p.offField ? 0.25 : 0) }) },
  { id: 'set:mh4', set: 'Marechaussee Hunter', need: 4, label: 'ファントムハンター 4: HP変動で会心率+12%/スタック',
    params: [number('stacks', 'スタック', 3, { min: 0, max: 3, step: 1 })],
    effects: (p) => ({ cr: 0.12 * p.stacks }) },
  { id: 'set:vourukasha', set: "Vourukasha's Glow", need: 4, label: '花海甘露の光 4: 元素スキル・爆発ダメージ+10%（被ダメで強化）',
    params: [number('stacks', '被ダメスタック', 0, { min: 0, max: 5, step: 1 })],
    effects: (p) => {
      const v = 0.1 * (1 + 0.8 * p.stacks);
      return { 'dmg.skill': v, 'dmg.burst': v };
    } },
  { id: 'set:nymph', set: "Nymph's Dream", need: 4, label: '水仙の夢 4: 鏡の水仙スタックで攻撃力・水ダメージアップ',
    params: [number('stacks', 'スタック', 3, { min: 0, max: 3, step: 1 })],
    effects: (p) => ({ 'atk%': [0, 0.07, 0.16, 0.25][p.stacks], 'dmg.hydro': [0, 0.04, 0.09, 0.15][p.stacks] }) },
  { id: 'set:fohw', set: 'Fragment of Harmonic Whimsy', need: 4, label: '諧律奇想の断章 4: 命の契約変動でダメージ+18%/スタック',
    params: [number('stacks', 'スタック', 3, { min: 0, max: 3, step: 1 })],
    effects: (p) => ({ dmg: 0.18 * p.stacks }) },
  { id: 'set:reverie', set: 'Unfinished Reverie', need: 4, label: '在りし日の歌 4: 燃焼状態の敵がいる時ダメージ+50%', defaultOn: false,
    effects: () => ({ dmg: 0.5 }) },
  { id: 'set:nwew', set: 'Nighttime Whispers in the Echoing Woods', need: 4, label: '残響の森で囁かれる夜話 4: スキル後 岩ダメージ+20%（結晶シールドで+150%）',
    params: [toggle('shield', '結晶シールド中', false)],
    effects: (p) => ({ 'dmg.geo': 0.2 * (p.shield ? 2.5 : 1) }) },
  { id: 'set:codex4', set: 'Obsidian Codex', need: 4, label: '黒曜の秘典 4: 夜魂値消費後 会心率+40%',
    effects: () => ({ cr: 0.4 }) },
  { id: 'set:cinder', set: 'Scroll of the Hero of Cinder City', need: 4, label: '灰燼の都に立つ英雄の絵巻 4: 反応後 元素ダメージ+12%（夜魂バースト時+28%）',
    params: [toggle('nightsoul', '夜魂加護中', false)],
    effects: (p, ctx) => ({ [`dmg.${ctx.element}`]: 0.12 + (p.nightsoul ? 0.28 : 0) }) },
  { id: 'set:finale', set: 'Finale of the Deep Galleries', need: 4, label: '深廊の終曲 4: 元素エネルギー0の時 通常・爆発ダメージ+60%', defaultOn: false,
    effects: () => ({ 'dmg.normal': 0.6, 'dmg.burst': 0.6 }) },
  { id: 'set:lno4', set: "Long Night's Oath", need: 4, label: '長き夜の誓い 4: 落下攻撃ダメージ+15%/スタック',
    params: [number('stacks', 'スタック', 5, { min: 0, max: 5, step: 1 })],
    effects: (p) => ({ 'dmg.plunge': 0.15 * p.stacks }) },
  { id: 'set:bolide', set: 'Retracing Bolide', need: 4, label: '逆飛びの流星 4: シールド中 通常・重撃ダメージ+40%', defaultOn: false,
    effects: () => ({ 'dmg.normal': 0.4, 'dmg.charged': 0.4 }) },
  { id: 'set:bloodstained', set: 'Bloodstained Chivalry', need: 4, label: '血染めの騎士道 4: 敵撃破後 重撃ダメージ+50%', defaultOn: false,
    effects: () => ({ 'dmg.charged': 0.5 }) },
  { id: 'set:rising', set: 'A Day Carved From Rising Winds', need: 4, label: '風起ちし日 4: 命中後 攻撃力+25%',
    effects: () => ({ 'atk%': 0.25 }) },
  { id: 'set:disenchant', set: 'Disenchantment in Deep Shadow', need: 4, label: '深き影の幻滅 4: 超電導状態の敵への会心率+16%', defaultOn: false,
    effects: () => ({ cr: 0.16 }) },
  { id: 'set:instructor', set: 'Instructor', need: 4, label: '教官 4: 反応後 元素熟知+120',
    effects: () => ({ em: 120 }) },
  { id: 'set:berserker', set: 'Berserker', need: 2, label: '狂戦士 2: 会心率+12%（パネル反映済みの場合はOFF）', defaultOn: false,
    effects: () => ({ cr: 0.12 }) },
];

// ---------------------------------------------------------------------------
// チームバフ（プリセット）
// ---------------------------------------------------------------------------
export const TEAM_BUFFS = [
  { id: 'team:bennett', label: 'ベネット 元素爆発（攻撃力加算）',
    params: [number('atk', '加算攻撃力', 1000, { min: 0, step: 10, hint: 'ベネットの基礎攻撃力×倍率（目安: 800〜1200）' })],
    effects: (p) => ({ atk: p.atk }) },
  { id: 'team:kazuha', label: '楓原万葉（翠緑4 + 固有天賦）',
    params: [
      select('element', '拡散する元素', 'self', ELEMENT_OPTIONS.filter(([k]) => ['self', 'pyro', 'hydro', 'electro', 'cryo'].includes(k))),
      number('bonus', '元素ダメージバフ(%)', 36, { min: 0, step: 1, hint: '万葉の元素熟知×0.04%' }),
    ],
    effects: (p, ctx) => {
      const el = resolveElement(p.element, ctx);
      return { [`res.${el}`]: 0.4, [`dmg.${el}`]: p.bonus / 100 };
    } },
  { id: 'team:zhongli', label: '鍾離 シールド（全耐性-20%）', effects: () => ({ 'res.all': 0.2 }) },
  { id: 'team:furina', label: 'フリーナ 元素爆発（与ダメージアップ）',
    params: [number('bonus', '与ダメージ(%)', 75, { min: 0, step: 1, hint: '気炎値300・天賦Lv10で75%' })],
    effects: (p) => ({ dmg: p.bonus / 100 }) },
  { id: 'team:mona', label: 'モナ 星異（与ダメージアップ）',
    params: [number('bonus', '与ダメージ(%)', 58, { min: 0, step: 1 })],
    effects: (p) => ({ dmg: p.bonus / 100 }) },
  { id: 'team:sucrose', label: 'スクロース（熟知共有）',
    params: [number('em', '元素熟知', 210, { min: 0, step: 10 })],
    effects: (p) => ({ em: p.em }) },
  { id: 'team:nahida', label: 'ナヒーダ 固有天賦（熟知共有）',
    params: [number('em', '元素熟知', 250, { min: 0, step: 10 })],
    effects: (p) => ({ em: p.em }) },
  { id: 'team:faruzan', label: 'ファルザン（風耐性-30%・風ダメージアップ）',
    params: [number('bonus', '風元素ダメージ(%)', 32, { min: 0, step: 1 })],
    effects: (p) => ({ 'res.anemo': 0.3, 'dmg.anemo': p.bonus / 100 }) },
  { id: 'team:xilonen', label: 'シロネン（耐性ダウン）',
    params: [
      select('element', '対象元素', 'self', ELEMENT_OPTIONS),
      number('shred', '耐性ダウン(%)', 36, { min: 0, step: 1 }),
    ],
    effects: (p, ctx) => ({ [`res.${resolveElement(p.element, ctx)}`]: p.shred / 100 }) },
  { id: 'team:citlali', label: 'シトラリ（炎・水耐性-20%）', effects: () => ({ 'res.pyro': 0.2, 'res.hydro': 0.2 }) },
  { id: 'team:chevreuse', label: 'シュヴルーズ（炎・雷耐性-40%、攻撃力+20%）', effects: () => ({ 'res.pyro': 0.4, 'res.electro': 0.4, 'atk%': 0.2 }) },
  { id: 'team:shenhe', label: '申鶴（氷・物理耐性-15%、氷ダメージ加算）',
    params: [number('flat', '氷ダメージ加算値', 2500, { min: 0, step: 50, hint: '申鶴の攻撃力×天賦倍率' })],
    effects: (p) => ({ 'res.cryo': 0.15, 'res.physical': 0.15, 'flat.cryo': p.flat }) },
  { id: 'team:yunjin', label: '雲菫 元素爆発（通常攻撃ダメージ加算）',
    params: [number('flat', '加算値', 2000, { min: 0, step: 50 })],
    effects: (p) => ({ 'flat.normal': p.flat }) },
  { id: 'team:sara', label: '九条裟羅（攻撃力加算）',
    params: [number('atk', '加算攻撃力', 700, { min: 0, step: 10 })],
    effects: (p) => ({ atk: p.atk }) },
  { id: 'team:noblesse', label: '旧貴族4（味方）攻撃力+20%', effects: () => ({ 'atk%': 0.2 }) },
  { id: 'team:tom', label: '千岩牢固4（味方）攻撃力+20%', effects: () => ({ 'atk%': 0.2 }) },
  { id: 'team:ttds', label: '龍殺しの英傑譚（攻撃力+48%）', effects: () => ({ 'atk%': 0.48 }) },
  { id: 'team:instructor', label: '教官4（味方）元素熟知+120', effects: () => ({ em: 120 }) },
  { id: 'team:pyroReso', label: '元素共鳴: 炎（攻撃力+25%）', effects: () => ({ 'atk%': 0.25 }) },
  { id: 'team:hydroReso', label: '元素共鳴: 水（HP+25%）', effects: () => ({ 'hp%': 0.25 }) },
  { id: 'team:cryoReso', label: '元素共鳴: 氷（会心率+15%）', effects: () => ({ cr: 0.15 }) },
  { id: 'team:geoReso', label: '元素共鳴: 岩（ダメージ+15%、岩耐性-20%）', effects: () => ({ dmg: 0.15, 'res.geo': 0.2 }) },
  { id: 'team:dendroReso', label: '元素共鳴: 草（元素熟知アップ）',
    params: [number('em', '元素熟知', 80, { min: 50, max: 100, step: 10 })],
    effects: (p) => ({ em: p.em }) },
];

// ---------------------------------------------------------------------------
// カスタム（武器効果・命ノ星座など、自動化されていない効果を手入力）
// ---------------------------------------------------------------------------
export const CUSTOM_BUFF = {
  id: 'custom', label: 'カスタムバフ（武器効果・命ノ星座など）',
  params: [
    number('atkPct', '攻撃力%', 0, { step: 1 }),
    number('atk', '攻撃力(実数)', 0, { step: 10 }),
    number('hpPct', 'HP%', 0, { step: 1 }),
    number('defPct', '防御力%', 0, { step: 1 }),
    number('em', '元素熟知', 0, { step: 10 }),
    number('cr', '会心率%', 0, { step: 0.1 }),
    number('cd', '会心ダメージ%', 0, { step: 0.1 }),
    number('dmg', '与ダメージ%', 0, { step: 1 }),
    number('dmgNormal', '通常攻撃ダメージ%', 0, { step: 1 }),
    number('dmgCharged', '重撃ダメージ%', 0, { step: 1 }),
    number('dmgSkill', '元素スキルダメージ%', 0, { step: 1 }),
    number('dmgBurst', '元素爆発ダメージ%', 0, { step: 1 }),
    number('res', '敵の耐性ダウン%', 0, { step: 1 }),
    number('defRed', '敵の防御ダウン%', 0, { step: 1 }),
  ],
  effects: (p) => ({
    'atk%': p.atkPct / 100, atk: p.atk, 'hp%': p.hpPct / 100, 'def%': p.defPct / 100, em: p.em,
    cr: p.cr / 100, cd: p.cd / 100, dmg: p.dmg / 100,
    'dmg.normal': p.dmgNormal / 100, 'dmg.charged': p.dmgCharged / 100,
    'dmg.skill': p.dmgSkill / 100, 'dmg.burst': p.dmgBurst / 100,
    'res.all': p.res / 100, defRed: p.defRed / 100,
  }),
};

// ---------------------------------------------------------------------------

/** パラメータの既定値と保存値をマージ */
export function resolveParams(def, saved = {}) {
  const p = {};
  for (const prm of def.params ?? []) {
    const v = saved[prm.key];
    p[prm.key] = v === undefined || v === null || v === '' ? prm.default : prm.type === 'number' ? Number(v) : v;
  }
  return p;
}

/** 装備中セットから有効なセット効果定義を列挙 */
export function activeSetBuffs(build, ctx) {
  const sets = build.sets ?? {};
  return ARTIFACT_SETS.filter((d) => (sets[d.set] ?? 0) >= d.need && (!d.available || d.available(ctx)));
}

export function addEffects(target, eff) {
  for (const [k, v] of Object.entries(eff ?? {})) {
    if (!v) continue;
    target[k] = (target[k] ?? 0) + v;
  }
  return target;
}

/** バフがONかどうか（保存状態 → 定義の既定 → グループの既定 の順） */
export function isBuffOn(def, state = {}, fallbackOn = true) {
  const s = state[def.id];
  if (s && typeof s.on === 'boolean') return s.on;
  if (typeof def.defaultOn === 'boolean') return def.defaultOn;
  return fallbackOn;
}

/**
 * 有効なバフ定義の一覧を返す
 * @param {Array} defs バフ定義
 * @param {object} state { [id]: { on:boolean, params:{} } }
 * @param {boolean} fallbackOn 定義・保存状態ともに未指定のときの既定
 */
export function enabledBuffs(defs, state = {}, fallbackOn = true) {
  const out = [];
  for (const def of defs) {
    const s = state[def.id];
    const on = isBuffOn(def, state, fallbackOn);
    if (!on) continue;
    out.push({ def, params: resolveParams(def, s?.params) });
  }
  return out;
}

export { ELEMENTS };
