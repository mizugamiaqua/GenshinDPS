// 4人編成のチームローテーション計算。
// - メンバーの実際のビルドからチームバフを自動計算（ベネットの攻撃力加算＝ベネットの基礎攻撃力×倍率 など）
// - 各メンバーのコンボを合算し、ローテーション時間で割ってチームDPSを出す
// - 推奨チームローテ: サポートは元素スキル/爆発（＋持続ダメージ）、メインアタッカーは残りのフィールド時間を使う
import { createEngine, normalizeSettings } from './engine.js';
import { isBuffOn, resolveParams } from './buffs.js';
import { evaluateCombo, recommendCombo } from './rotation.js';
import { profileFor } from './profiles.js';
import { ELEMENT_JA } from './constants.js';

const SWIRLABLE = new Set(['pyro', 'hydro', 'electro', 'cryo']);
const number = (key, label, def, opts = {}) => ({ key, label, type: 'number', default: def, ...opts });
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const int = (x) => Math.round(x).toLocaleString('ja-JP');

export const DEFAULT_TEAM = Object.freeze({
  name: '',
  members: [null, null, null, null],
  mainIndex: null,
  mainAuto: true,
  rotationLength: 20,
  enemy: { level: 100, res: 10 },
  reactions: {},
  buffs: {},
  combos: [null, null, null, null],
});

export function normalizeTeam(t = {}) {
  const members = [...(t.members ?? [])];
  while (members.length < 4) members.push(null);
  const combos = [...(t.combos ?? [])];
  while (combos.length < 4) combos.push(null);
  return {
    ...DEFAULT_TEAM,
    ...t,
    members: members.slice(0, 4),
    combos: combos.slice(0, 4),
    enemy: { ...DEFAULT_TEAM.enemy, ...(t.enemy ?? {}) },
    reactions: { ...(t.reactions ?? {}) },
    buffs: { ...(t.buffs ?? {}) },
    rotationLength: Number(t.rotationLength) > 0 ? Number(t.rotationLength) : DEFAULT_TEAM.rotationLength,
  };
}

// ---------------------------------------------------------------------------
// チームバフ（提供元メンバーの実ステータスから計算）
// scope: 'all' = 自分を含む全員, 'others' = 自分以外
// ---------------------------------------------------------------------------
const CHARACTER_BUFFS = {
  Bennett: (p) => {
    const ratio = p.engine.ctx.talentValue('burst', /^ATK Bonus Ratio$/) + (p.build.constellation >= 1 ? 0.2 : 0);
    const atk = p.engine.stats.baseAtk * ratio;
    return [{ suffix: 'burst', label: `ベネット 元素爆発: 攻撃力 +${int(atk)}（基礎攻撃力×${pct(ratio)}）`, scope: 'all', effects: () => ({ atk }) }];
  },
  'Kaedehara Kazuha': (p) => {
    const bonus = 0.0004 * p.engine.stats.em;
    return [{
      suffix: 'a4', label: `楓原万葉 固有天賦: 拡散した元素のダメージ +${pct(bonus)}（元素熟知 ${int(p.engine.stats.em)}）`, scope: 'others',
      applies: (ctx) => SWIRLABLE.has(ctx.element), effects: (prm, ctx) => ({ [`dmg.${ctx.element}`]: bonus }),
    }];
  },
  Sucrose: (p) => {
    const em = 0.2 * p.engine.stats.em + 50;
    return [{ suffix: 'em', label: `スクロース 固有天賦: 元素熟知 +${int(em)}（スクロースの熟知の20%＋50）`, scope: 'others', effects: () => ({ em }) }];
  },
  Nahida: (p, team) => {
    const top = Math.max(...team.map((m) => m.engine.stats.em));
    const em = Math.min(250, 0.25 * top);
    return [{ suffix: 'a1', label: `ナヒーダ 固有天賦: 元素熟知 +${int(em)}（チーム最大熟知の25%）`, scope: 'all', effects: () => ({ em }) }];
  },
  Furina: (p) => {
    const ratio = p.engine.ctx.talentValue('burst', /^Fanfare to DMG Increase Conversion Ratio$/);
    const max = p.build.constellation >= 1 ? 400 : 300;
    return [{
      suffix: 'burst', label: `フリーナ 元素爆発: 与ダメージアップ（気炎値1につき${pct(ratio)}）`, scope: 'all',
      // 気炎値は戦闘中に徐々に溜まるため、既定は最大値の75%を平均とする
      params: [number('fanfare', '平均の気炎値', Math.round(max * 0.75), { min: 0, max, step: 10 })],
      effects: (prm) => ({ dmg: prm.fanfare * ratio }),
    }];
  },
  Mona: (p) => {
    const bonus = p.engine.ctx.talentValue('burst', /^DMG Bonus$/);
    return [{ suffix: 'omen', label: `モナ 元素爆発「星異」: 与ダメージ +${pct(bonus)}`, scope: 'all', effects: () => ({ dmg: bonus }) }];
  },
  Shenhe: (p) => {
    const flat = p.engine.stats.atk * p.engine.ctx.talentValue('skill', /^DMG Bonus$/);
    const res = p.engine.ctx.talentValue('burst', /^RES Decrease$/);
    return [
      { suffix: 'quill', label: `申鶴 元素スキル「冰翎」: 氷元素ダメージ +${int(flat)}`, scope: 'others', applies: (ctx) => ctx.element === 'cryo', effects: () => ({ 'flat.cryo': flat }) },
      { suffix: 'burst', label: `申鶴 元素爆発: 氷・物理耐性 -${pct(res)}`, scope: 'all', effects: () => ({ 'res.cryo': res, 'res.physical': res }) },
    ];
  },
  'Yun Jin': (p, team) => {
    const types = new Set(team.map((m) => m.charData.element)).size;
    const ratio = p.engine.ctx.talentValue('burst', /^DMG Increase$/) + [0, 0.025, 0.05, 0.075, 0.115][types];
    const flat = p.engine.stats.def * ratio;
    return [{ suffix: 'burst', label: `雲菫 元素爆発: 通常攻撃ダメージ +${int(flat)}（防御力×${pct(ratio)}）`, scope: 'others', effects: () => ({ 'flat.normal': flat }) }];
  },
  'Kujou Sara': (p) => {
    const atk = p.engine.stats.baseAtk * p.engine.ctx.talentValue('skill', /^ATK Bonus Ratio$/);
    return [{ suffix: 'skill', label: `九条裟羅 天狗呪雷: 攻撃力 +${int(atk)}`, scope: 'others', effects: () => ({ atk }) }];
  },
  Zhongli: () => [{ suffix: 'shield', label: '鍾離 シールド: 全耐性 -20%', scope: 'all', effects: () => ({ 'res.all': 0.2 }) }],
  Faruzan: (p) => {
    const bonus = p.engine.ctx.talentValue('burst', /^Anemo DMG Bonus$/);
    const res = p.engine.ctx.talentValue('burst', /^Anemo RES Decrease$/);
    const flat = 0.32 * p.engine.stats.baseAtk;
    return [{
      suffix: 'burst', label: `ファルザン 元素爆発: 風耐性 -${pct(res)}・風元素ダメージ +${pct(bonus)}・風ダメージ +${int(flat)}`, scope: 'all',
      applies: (ctx) => ctx.element === 'anemo', effects: () => ({ 'res.anemo': res, 'dmg.anemo': bonus, 'flat.anemo': flat }),
    }];
  },
  Xilonen: (p) => {
    const res = p.engine.ctx.talentValue('skill', /^Elemental RES Decrease$/);
    return [{
      suffix: 'skill', label: `シロネン 元素スキル: 元素耐性 -${pct(res)}`, scope: 'all',
      applies: (ctx) => ctx.element !== 'anemo' && ctx.element !== 'dendro', effects: (prm, ctx) => ({ [`res.${ctx.element}`]: res }),
    }];
  },
  Citlali: () => [{ suffix: 'a1', label: 'シトラリ 固有天賦: 炎・水耐性 -20%', scope: 'all', effects: () => ({ 'res.pyro': 0.2, 'res.hydro': 0.2 }) }],
  Chevreuse: (p, team) => {
    if (!team.every((m) => ['pyro', 'electro'].includes(m.charData.element))) return [];
    return [{ suffix: 'a1', label: 'シュヴルーズ 固有天賦: 炎・雷耐性 -40%・攻撃力 +20%（炎・雷のみの編成）', scope: 'all', effects: () => ({ 'res.pyro': 0.4, 'res.electro': 0.4, 'atk%': 0.2 }) }];
  },
  Gorou: (p, team) => {
    const def = p.engine.ctx.talentValue('skill', /^DEF Increase$/);
    const geo = team.filter((m) => m.charData.element === 'geo').length;
    const bonus = geo >= 3 ? p.engine.ctx.talentValue('skill', /^Geo DMG Bonus$/) : 0;
    return [{ suffix: 'skill', label: `ゴロー 元素スキル: 防御力 +${int(def)}${bonus ? `・岩元素ダメージ +${pct(bonus)}` : ''}`, scope: 'all', effects: () => ({ def, 'dmg.geo': bonus }) }];
  },
  Yelan: () => [{
    suffix: 'a4', label: '夜蘭 固有天賦: 与ダメージアップ（平均）', scope: 'others',
    params: [number('bonus', '平均与ダメージ(%)', 25, { min: 0, max: 50, step: 1 })], effects: (prm) => ({ dmg: prm.bonus / 100 }),
  }],
  Columbina: (p) => {
    const bonus = p.engine.ctx.talentValue('burst', /^Lunar Reaction DMG Bonus$/);
    return [{ suffix: 'burst', label: `コロンビーナ 元素爆発: 月反応ダメージ +${pct(bonus)}`, scope: 'all', effects: () => ({ 'dmg.lunar': bonus }) }];
  },
  Lauma: (p) => {
    const res = p.engine.ctx.talentValue('skill', /^Elemental RES Decrease$/);
    return [{ suffix: 'skill', label: `ラウマ 元素スキル: 草・水耐性 -${pct(res)}`, scope: 'all', effects: () => ({ 'res.dendro': res, 'res.hydro': res }) }];
  },
};

const SET_BUFFS = [
  { set: 'Noblesse Oblige', key: 'noblesse', label: '旧貴族のしつけ4: 攻撃力 +20%', effects: () => ({ 'atk%': 0.2 }) },
  { set: 'Tenacity of the Millelith', key: 'tom', label: '千岩牢固4: 攻撃力 +20%', effects: () => ({ 'atk%': 0.2 }) },
  { set: 'Instructor', key: 'instructor', label: '教官4: 元素熟知 +120', effects: () => ({ em: 120 }) },
  { set: 'Deepwood Memories', key: 'deepwood', label: '深林の記憶4: 草耐性 -30%', applies: (ctx) => ctx.element === 'dendro', effects: () => ({ 'res.dendro': 0.3 }) },
  { set: 'Viridescent Venerer', key: 'vv', label: '翠緑の影4: 拡散した元素の耐性 -40%', applies: (ctx) => SWIRLABLE.has(ctx.element), effects: (prm, ctx) => ({ [`res.${ctx.element}`]: 0.4 }) },
  { set: 'Scroll of the Hero of Cinder City', key: 'cinder', label: '灰燼の都に立つ英雄の絵巻4: 元素ダメージ +12%', effects: (prm, ctx) => ({ [`dmg.${ctx.element}`]: 0.12 }) },
];

const RESONANCE = {
  pyro: { label: '元素共鳴「燃え盛る炎」: 攻撃力 +25%', effects: () => ({ 'atk%': 0.25 }) },
  hydro: { label: '元素共鳴「癒しの水」: HP +25%', effects: () => ({ 'hp%': 0.25 }) },
  cryo: { label: '元素共鳴「粉砕の氷」: 会心率 +15%（氷元素の影響を受けた敵）', effects: () => ({ cr: 0.15 }) },
  geo: { label: '元素共鳴「堅定の岩」: ダメージ +15%・岩耐性 -20%', effects: () => ({ dmg: 0.15, 'res.geo': 0.2 }) },
  dendro: {
    label: '元素共鳴「蔓生の草」: 元素熟知アップ', params: [number('em', '元素熟知', 80, { min: 50, max: 100, step: 10 })],
    effects: (prm) => ({ em: prm.em }),
  },
};

/**
 * チームバフの一覧を作る
 * @param {Array<{index:number, uid:string, charData:object, build:object, engine:object}>} team
 * @returns {Array<{id:string, provider:number|null, scope:'all'|'others', def:object}>}
 */
export function teamLinkBuffs(team) {
  const out = [];
  const push = (id, provider, scope, src) => out.push({
    id, provider, scope,
    def: { id, label: src.label, params: src.params, defaultOn: src.defaultOn ?? true, applies: src.applies, effects: src.effects },
  });
  for (const m of team) {
    const fn = CHARACTER_BUFFS[m.charData.key];
    for (const b of fn ? fn(m, team) : []) push(`tl:${m.charData.key}:${b.suffix}`, m.index, b.scope, b);
    for (const s of SET_BUFFS) {
      if ((m.build.sets?.[s.set] ?? 0) >= 4) push(`tl:set:${s.key}:${m.charData.key}`, m.index, 'others', { ...s, label: `${m.build.nameJa}の${s.label}` });
    }
    if (m.build.weapon?.nameEn === 'Thrilling Tales of Dragon Slayers') {
      const v = 0.24 + 0.06 * ((m.build.weapon.refinement ?? 1) - 1);
      push(`tl:ttds:${m.charData.key}`, m.index, 'others', { label: `${m.build.nameJa}の龍殺しの英傑譚: 攻撃力 +${pct(v)}`, effects: () => ({ 'atk%': v }) });
    }
  }
  const counts = {};
  for (const m of team) counts[m.charData.element] = (counts[m.charData.element] ?? 0) + 1;
  for (const [el, r] of Object.entries(RESONANCE)) {
    if ((counts[el] ?? 0) >= 2) push(`tl:reso:${el}`, null, 'all', r);
  }
  return out;
}

/** あるメンバーが受け取るチームバフか */
function receives(link, member) {
  if (link.scope === 'others' && link.provider === member.index) return false;
  return !link.def.applies || link.def.applies(member.engine.ctx);
}

/**
 * チーム全体の計算エンジンを組み立てる
 * @param {Array<{uid?:string, charData:object, build:object, settings:object}|null>} inputs 最大4人
 * @param {object} rawTeam チーム設定
 */
export function createTeam(inputs, rawTeam) {
  const team = normalizeTeam(rawTeam);
  const memberSettings = (inp, i) => {
    const s = normalizeSettings(inp.settings);
    s.enemy = { ...team.enemy };
    if (team.reactions[i]) s.reaction = { ...s.reaction, ...team.reactions[i] };
    return s;
  };
  // 1) チームバフ無しのエンジン（提供元のステータス計算用）
  const base = inputs
    .map((inp, index) => (inp ? { index, ...inp, settings: memberSettings(inp, index) } : null))
    .filter(Boolean)
    .map((m) => ({ ...m, engine: createEngine(m.charData, m.build, m.settings, { teamBuffs: [] }) }));
  // 2) チームバフを計算して各メンバーに配る
  const links = teamLinkBuffs(base);
  const members = base.map((m) => {
    const received = links.filter((l) => receives(l, m));
    const on = received.filter((l) => isBuffOn(l.def, team.buffs, l.def.defaultOn));
    const engine = createEngine(m.charData, m.build, m.settings, {
      teamBuffs: on.map((l) => ({ def: l.def, params: resolveParams(l.def, team.buffs[l.id]?.params) })),
    });
    return { ...m, engine, received: received.map((l) => l.id) };
  });
  const linkList = links.map((l) => ({
    ...l,
    on: isBuffOn(l.def, team.buffs, l.def.defaultOn),
    params: resolveParams(l.def, team.buffs[l.id]?.params),
    receivers: members.filter((m) => m.received.includes(l.id)).map((m) => m.index),
  }));
  return { team, members, links: linkList };
}

// 役割ごとの並び順（ローテーションの先頭から）
// シールド・耐性ダウン → 設置・控えアタッカー → 短時間のバッファー（直後のメインに乗せる）→ メイン
const SHIELDERS = new Set(['Zhongli', 'Diona', 'Layla', 'Kirara', 'Noelle', 'Thoma', 'Candace', 'Citlali', 'Ineffa', 'Lauma']);
const BUFFERS = new Set(['Bennett', 'Kaedehara Kazuha', 'Sucrose', 'Mona', 'Kujou Sara', 'Faruzan', 'Chevreuse', 'Shenhe', 'Yun Jin',
  'Gorou', 'Xilonen', 'Rosaria', 'Lynette', 'Lan Yan', 'Yumemizuki Mizuki', 'Xianyun', 'Ifa']);

export function roleOf(m, mainIndex) {
  if (m.index === mainIndex) return 'main';
  if (SHIELDERS.has(m.charData.key)) return 'shield';
  if (BUFFERS.has(m.charData.key)) return 'buffer';
  return 'sub';
}
export const ROLE_JA = { main: 'メインアタッカー', shield: 'シールド・デバフ', sub: 'サブアタッカー（控え）', buffer: 'バッファー' };
const ROLE_ORDER = { shield: 0, sub: 1, buffer: 2, main: 3 };

/**
 * メインアタッカーを推定:
 * 「フィールドを任せたときに増えるダメージ ÷ 増えるフィールド時間」が最も大きいメンバー。
 * 控えでのダメージが中心のキャラ（夜蘭・フリーナなど）は、フィールドにいても伸びないためメインに選ばれにくい
 */
export function guessMain(members, L = 20) {
  let best = null;
  for (const m of members) {
    const sup = recommendCombo(m.engine, { role: 'support', rotationLength: L });
    const main = recommendCombo(m.engine, { role: 'main', rotationLength: L, fieldBudget: L * 0.6 });
    const s = evaluateCombo(m.engine, { ...sup.combo, duration: null });
    const f = evaluateCombo(m.engine, { ...main.combo, duration: null });
    let gain = (f.totalDamage - s.totalDamage) / Math.max(0.5, f.totalTime - s.totalTime);
    if (profileFor(m.charData)?.support || BUFFERS.has(m.charData.key) || SHIELDERS.has(m.charData.key)) gain *= 0.5;
    if (!best || gain > best.gain) best = { index: m.index, gain };
  }
  return best?.index ?? members[0]?.index ?? null;
}

/**
 * 推奨チームローテを生成
 * サポートは役割順に元素スキル・爆発（＋持続ダメージ）、メインアタッカーは残りのフィールド時間を使う
 */
export function recommendTeam(teamCalc, { mainIndex = null } = {}) {
  const { team, members } = teamCalc;
  const L = team.rotationLength;
  const main = mainIndex ?? team.mainIndex ?? guessMain(members, L);
  const combos = [null, null, null, null];
  const notes = [];
  const order = [];
  const supports = members
    .filter((m) => m.index !== main)
    .map((m) => ({ m, role: roleOf(m, main) }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.m.index - b.m.index);
  let t = 0;
  for (const { m, role } of supports) {
    const rec = recommendCombo(m.engine, { role: 'support', rotationLength: L });
    combos[m.index] = { ...rec.combo, duration: null };
    order.push({ index: m.index, name: m.build.nameJa, role, start: Math.round(t * 10) / 10, steps: rec.timeline.map((s) => s.label) });
    t += rec.fieldTime;
  }
  const supportField = t;
  const mainMember = members.find((m) => m.index === main);
  if (mainMember) {
    const budget = Math.max(0, L - supportField);
    const rec = recommendCombo(mainMember.engine, { role: 'main', rotationLength: L, fieldBudget: budget });
    combos[main] = { ...rec.combo, duration: null };
    order.push({
      index: main, name: mainMember.build.nameJa, role: 'main', start: Math.round(t * 10) / 10,
      steps: rec.timeline.map((s) => `${(Math.round((t + s.start) * 10) / 10).toFixed(1)}秒 ${s.label}`),
    });
    notes.push(`メインアタッカーは${mainMember.build.nameJa}（フィールド時間を任せたときのダメージの伸びが最も大きいメンバー）。サポートの行動に約${Math.round(supportField * 10) / 10}秒、残り約${Math.round(budget * 10) / 10}秒をメインが使います。`);
    if (budget < 6) notes.push('メインアタッカーのフィールド時間が短くなっています。ローテーション時間を延ばすと通常攻撃の時間を確保できます。');
  }
  notes.push('順番は「シールド・デバフ → サブアタッカー（設置・控え攻撃）→ バッファー → メイン」です。バッファーはメインの直前に置き、効果時間を無駄にしないようにしています。');
  notes.push('サポートの元素スキルはローテーション中1回（CDが短いキャラはメインの攻撃中にもう一度使える場合があります）。持続ダメージのヒット数は目安なので、必要に応じて回数を調整してください。');
  return { combos, mainIndex: main, order, notes };
}

/** チームローテを評価 */
export function evaluateTeam(teamCalc, combos = teamCalc.team.combos) {
  const L = teamCalc.team.rotationLength;
  const rows = teamCalc.members.map((m) => {
    const r = evaluateCombo(m.engine, { entries: combos[m.index]?.entries ?? [], duration: null });
    return { index: m.index, member: m, result: r, damage: r.totalDamage, fieldTime: r.totalTime };
  });
  const total = rows.reduce((s, r) => s + r.damage, 0);
  const fieldTime = rows.reduce((s, r) => s + r.fieldTime, 0);
  for (const r of rows) r.share = total > 0 ? r.damage / total : 0;
  return {
    rows,
    totalDamage: total,
    rotationLength: L,
    dps: L > 0 ? total / L : 0,
    fieldTime,
    overTime: fieldTime > L + 0.01,
  };
}

export { ELEMENT_JA };
