// キャラクター別プロファイル
// 自動抽出した天賦倍率だけでは表現できない「自己バフ」「持続ダメージの回数」「推奨コンボの方針」を補う。
// プロファイルが無いキャラも汎用ロジックで計算・推奨コンボ生成ができる。
//
// 主なフィールド:
//   infusion        通常/重撃/落下を元素ダメージにする（元素付与持ち）
//   buffs           自己バフ定義（buffs.js と同じ形式。rowMods で特定の行だけ強化も可能）
//   hitCounts(ctx)  推奨コンボでの行ごとのヒット数 { [nameEn]: 回数 }
//   skillCasts      ローテーション中の元素スキル使用回数
//   stateTalent     「特殊状態」中に通常攻撃の代わりに使う行の天賦（雷電の夢想の一心など）
//   stateDuration   特殊状態の秒数
//   fillNormal      空き時間を通常攻撃で埋めるか（控えアタッカーは false）
//   rotationLength  ローテーション秒数（控えアタッカーのDPS算出用）
//   pattern         通常攻撃の最適パターンを固定 { chain: 段数, charged: 重撃の nameEn | null, time: 1回の秒数 }

// 元素付与などで通常攻撃が元素ダメージになるキャラ（プロファイル未定義でも適用）
export const INFUSION_CHARACTERS = new Set([
  'Hu Tao', 'Kamisato Ayaka', 'Diluc', 'Keqing', 'Chongyun', 'Noelle', 'Xiao', 'Arataki Itto', 'Cyno',
  'Alhaitham', 'Tartaglia', 'Yoimiya', 'Kamisato Ayato', 'Arlecchino', 'Clorinde', 'Kaveh', 'Skirk', 'Mavuika',
]);

// 元素スキル/爆発でも物理ダメージになる行
export const ELEMENT_OVERRIDES = {
  Eula: { burst: { 'Lightfall Sword Base DMG': 'physical', 'DMG Per Stack': 'physical' } },
};

const toggle = (key, label, def = true) => ({ key, label, type: 'toggle', default: def });
const number = (key, label, def, opts = {}) => ({ key, label, type: 'number', default: def, ...opts });

export const PROFILES = {
  'Hu Tao': {
    infusion: true,
    buffs: [
      { id: 'profile:hutao:e', label: '冥蝶の舞（元素スキル）: HP上限に応じて攻撃力アップ（基礎攻撃力の400%まで）',
        dynamic: (p, s, ctx) => ({ atk: Math.min(s.hp * ctx.talentValue('skill', /^ATK Increase$/), 4 * s.baseAtk) }) },
      { id: 'profile:hutao:a4', label: '固有天賦「血のかまど」: HP50%以下で炎元素ダメージ+33%',
        effects: () => ({ 'dmg.pyro': 0.33 }) },
    ],
    hitCounts: () => ({ 'Blood Blossom DMG': 2 }),
    skillCasts: 1,
    // 冥蝶の舞の9秒間に「通常1段+重撃」を繰り返すのが定番
    pattern: { chain: 1, charged: 'Charged Attack', time: 1.05 },
    fillDuration: 8.5,
    fillNormal: true,
    rotationLength: null,
    notes: ['冥蝶の舞（9秒）中に「通常1段→重撃」を繰り返し、最後に低HP状態の元素爆発で締めるのが定番です。'],
  },

  'Raiden Shogun': {
    buffs: [
      { id: 'profile:raiden:eye', label: '雷電将軍 元素スキル: 元素爆発ダメージアップ（元素エネルギー90×倍率）',
        effects: (p, ctx) => ({ 'dmg.burst': 90 * ctx.talentValue('skill', /^Elemental Burst DMG Bonus$/) }) },
      { id: 'profile:raiden:resolve', label: '諸願百目の輪（願力スタック）',
        params: [number('stacks', '願力スタック', 60, { min: 0, max: 60, step: 1 })],
        rowMods: (p, ctx) => {
          const initial = ctx.talentValue('burst', /^Resolve Bonus$/, 0);
          const perHit = ctx.talentValue('burst', /^Resolve Bonus$/, 1);
          return [
            { talent: 'burst', match: /^Musou no Hitotachi/, multAdd: initial * p.stacks },
            { talent: 'burst', match: /Hit DMG|Charged Attack|Plunge/, multAdd: perHit * p.stacks },
          ];
        } },
      { id: 'profile:raiden:a4', label: '固有天賦「殊勝なる御体」: 元素チャージ効率100%超過分1%につき雷元素ダメージ+0.4%',
        dynamic: (p, s) => ({ 'dmg.electro': Math.max(0, s.er - 1) * 0.4 }) },
      { id: 'profile:raiden:c2', label: '2凸「斬鉄断金」: 夢想の一心中 敵の防御力を60%無視',
        available: (ctx) => ctx.constellation >= 2,
        rowMods: () => [{ talent: 'burst', match: /./, defIgnore: 0.6 }] },
    ],
    hitCounts: () => ({ 'Coordinated ATK DMG': 5 }),
    skillCasts: 1,
    stateTalent: 'burst',
    stateDuration: 7,
    fillNormal: false,
    rotationLength: null,
    notes: ['元素スキルで爆発ダメージバフを付与 → 元素爆発「夢想の一太刀」→ 夢想の一心状態（約7秒）で通常攻撃・重撃を繰り返します。'],
  },

  Xiangling: {
    buffs: [
      { id: 'profile:xiangling:a4', label: '固有天賦「絶雲の唐辛子」: 攻撃力+10%', defaultOn: false,
        effects: () => ({ 'atk%': 0.1 }) },
      { id: 'profile:xiangling:c1', label: '1凸「外はカリッ、中はフワッ」: 炎元素耐性-15%',
        available: (ctx) => ctx.constellation >= 1, effects: () => ({ 'res.pyro': 0.15 }) },
      { id: 'profile:xiangling:c6', label: '6凸「大龍捲旋火輪」: 炎元素ダメージ+15%',
        available: (ctx) => ctx.constellation >= 6, effects: () => ({ 'dmg.pyro': 0.15 }) },
    ],
    // グゥオパァーは4回噴火、旋火輪は約10秒で12ヒット（4凸で持続+40%）
    hitCounts: (ctx) => ({ 'Flame DMG': 4, 'Pyronado DMG': ctx.constellation >= 4 ? 17 : 12 }),
    skillCasts: 1,
    fillNormal: false,
    rotationLength: 20,
    notes: ['香菱は控えから旋火輪で戦うサブアタッカーのため、20秒ローテーションあたりのDPSで評価しています。'],
  },

  'Kamisato Ayaka': {
    infusion: true,
    buffs: [
      { id: 'profile:ayaka:a1', label: '固有天賦「天罪国罪鎮詞」: 元素スキル後 通常・重撃ダメージ+30%',
        effects: () => ({ 'dmg.normal': 0.3, 'dmg.charged': 0.3 }) },
      { id: 'profile:ayaka:a4', label: '固有天賦「寒天宣命祝詞」: 霰歩後 氷元素ダメージ+18%',
        effects: () => ({ 'dmg.cryo': 0.18 }) },
      { id: 'profile:ayaka:c4', label: '4凸「心鏡の泡影」: 敵の防御力-30%',
        available: (ctx) => ctx.constellation >= 4, effects: () => ({ defRed: 0.3 }) },
    ],
    hitCounts: () => ({ 'Cutting DMG': 19, 'Bloom DMG': 1 }),
    skillCasts: 2,
    pattern: { chain: 2, charged: 'Charged Attack DMG', time: 1.65 },
    fillNormal: true,
    notes: ['元素爆発「神里流・霜滅」は斬撃19回＋咲き1回で計算しています（大型の敵を想定）。'],
  },

  Nahida: {
    buffs: [
      { id: 'profile:nahida:a4', label: '固有天賦「慧明縁覚の智論」: 元素熟知200超過分に応じて滅浄三業のダメージ・会心率アップ',
        rowMods: (p, ctx, s) => {
          const over = Math.max(0, (s?.em ?? 0) - 200);
          return [{ talent: 'skill', match: /^Tri-Karma/, dmg: Math.min(over * 0.001, 0.8), cr: Math.min(over * 0.0003, 0.24) }];
        } },
    ],
    hitCounts: () => ({ 'Tri-Karma Purification DMG': 8 }),
    skillCasts: 1,
    fillNormal: false,
    rotationLength: 20,
    notes: ['ナヒーダは元素スキル1回で蘊種印を付与し、滅浄三業（約2.5秒ごと）を20秒で8回発動する想定です。'],
  },

  Eula: {
    buffs: [
      { id: 'profile:eula:grimheart', label: '冷酷な心（長押しスキル）: 物理耐性-25%',
        effects: (p, ctx) => ({ 'res.physical': ctx.talentValue('skill', /^Physical RES Decrease$/) || 0.25 }) },
    ],
    hitCounts: () => ({ 'Icewhirl Brand DMG': 2, 'DMG Per Stack': 13 }),
    skillCasts: 2,
    fillNormal: true,
    notes: ['光降の剣のエネルギー蓄積は13スタック（目安）で計算しています。'],
  },

  Ganyu: {
    buffs: [
      { id: 'profile:ganyu:a1', label: '固有天賦「唯此一心」: 霜華の矢の会心率+20%',
        effects: () => ({ 'cr.charged': 0.2 }) },
      { id: 'profile:ganyu:a4', label: '固有天賦「天地交泰」: 元素爆発範囲内で氷元素ダメージ+20%',
        effects: () => ({ 'dmg.cryo': 0.2 }) },
    ],
    hitCounts: () => ({ 'Ice Shard DMG': 18 }),
    pattern: { chain: 0, charged: ['Frostflake Arrow DMG', 'Frostflake Arrow Bloom DMG'], time: 1.75 },
    fillNormal: true,
    notes: ['甘雨は2段チャージ狙い撃ち（霜華の矢＋霜華満開）を連射する想定です。氷柱は単体の敵に約18回命中として計算しています。'],
  },

  Neuvillette: {
    buffs: [
      { id: 'profile:neuvillette:a1', label: '固有天賦「古の王の権威」: 衡平な裁量のダメージ倍率アップ',
        params: [number('stacks', '源水の雫スタック', 3, { min: 0, max: 3, step: 1 })],
        rowMods: (p) => [{ talent: 'normal', match: /Equitable Judgment/, multScale: [1, 1.1, 1.25, 1.6][p.stacks] }] },
      { id: 'profile:neuvillette:a4', label: '固有天賦「至高の裁き」: HP30%超過分に応じて水元素ダメージ（最大30%）',
        params: [number('bonus', '水元素ダメージ(%)', 30, { min: 0, max: 30, step: 1 })],
        effects: (p) => ({ 'dmg.hydro': p.bonus / 100 }) },
    ],
    pattern: { chain: 0, charged: 'Charged Attack: Equitable Judgment', time: 0.6 },
    fillNormal: true,
    notes: ['重撃「衡平な裁量」は約0.5秒ごとの継続ヒットとして、1ヒットあたり0.6秒（溜め時間込みの目安）で計算しています。'],
  },

  Mavuika: {
    stateTalent: 'skill',
    stateDuration: 10,
    skillCasts: 1,
    fillNormal: false,
    notes: ['マーヴィカは元素スキルの「焚焼の炎輪」状態（約10秒）で通常攻撃・重撃を行う想定です。'],
  },

  Yelan: {
    buffs: [
      { id: 'profile:yelan:a4', label: '固有天賦「妙転時来」: 与ダメージアップ（平均）',
        params: [number('bonus', '平均与ダメージ(%)', 25, { min: 0, max: 50, step: 1 })],
        effects: (p) => ({ dmg: p.bonus / 100 }) },
    ],
    // 玄擲玲瓏は約1秒ごとに3本の矢で協同攻撃（15秒で約14回）
    hitCounts: () => ({ 'Exquisite Throw DMG': 14 }),
    skillCasts: 1,
    fillNormal: false,
    rotationLength: 20,
    notes: ['夜蘭は控えで玄擲玲瓏による協同攻撃を行うサブアタッカーとして、20秒ローテーションで評価しています。'],
  },
};

export function profileFor(charData) {
  return PROFILES[charData?.key] ?? null;
}

/** 通常攻撃を元素ダメージ扱いにするか（設定 > プロファイル > 既定） */
export function hasInfusion(charData, setting = 'auto') {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  if (charData?.weaponType === 'WEAPON_CATALYST') return true;
  return !!PROFILES[charData?.key]?.infusion || INFUSION_CHARACTERS.has(charData?.key);
}

export { toggle, number };
