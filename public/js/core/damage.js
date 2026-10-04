// ダメージ計算式
//   ダメージ = (倍率×参照ステータス + 加算値) × (1 + ダメージバフ) × 会心 × 防御補正 × 耐性補正 × 増幅反応
import { DAMAGE_TYPES, levelMultiplier } from './constants.js';

const m = (mods, key) => mods?.[key] ?? 0;

/** パネル + バフ効果 → 最終ステータス */
export function computeStats(panel, mods = {}) {
  const dmg = {};
  for (const t of DAMAGE_TYPES) dmg[t] = (panel.dmg?.[t] ?? 0) + m(mods, `dmg.${t}`);
  return {
    baseHp: panel.baseHp,
    baseAtk: panel.baseAtk,
    baseDef: panel.baseDef,
    hp: panel.hp + panel.baseHp * m(mods, 'hp%') + m(mods, 'hp'),
    atk: panel.atk + panel.baseAtk * m(mods, 'atk%') + m(mods, 'atk'),
    def: panel.def + panel.baseDef * m(mods, 'def%') + m(mods, 'def'),
    em: panel.em + m(mods, 'em'),
    cr: panel.cr + m(mods, 'cr'),
    cd: panel.cd + m(mods, 'cd'),
    er: panel.er + m(mods, 'er'),
    heal: panel.heal ?? 0,
    dmg,
  };
}

/** 耐性補正 */
export function resMultiplier(res) {
  if (res < 0) return 1 - res / 2;
  if (res < 0.75) return 1 - res;
  return 1 / (4 * res + 1);
}

/** 防御補正 */
export function defMultiplier(charLevel, enemyLevel, defRed = 0, defIgnore = 0) {
  const c = charLevel + 100;
  const e = (enemyLevel + 100) * Math.max(0, 1 - Math.min(defRed, 0.9)) * (1 - Math.min(defIgnore, 1));
  return c / (c + e);
}

export const REACTIONS = {
  none: { label: 'なし' },
  vaporize: { label: '蒸発', kind: 'amp', elements: { pyro: 1.5, hydro: 2.0 } },
  melt: { label: '溶解', kind: 'amp', elements: { pyro: 2.0, cryo: 1.5 } },
  aggravate: { label: '超激化', kind: 'add', elements: { electro: 1.15 } },
  spread: { label: '草激化', kind: 'add', elements: { dendro: 1.25 } },
};

/** その元素で反応が起こせるか */
export function reactionApplies(type, element) {
  return !!REACTIONS[type]?.elements?.[element];
}

/** 増幅反応（蒸発・溶解）の倍率 */
export function ampMultiplier(type, element, em, bonus = 0) {
  const base = REACTIONS[type]?.kind === 'amp' ? REACTIONS[type].elements[element] : null;
  if (!base) return 1;
  return base * (1 + (2.78 * em) / (em + 1400) + bonus);
}

/** 激化反応（超激化・草激化）の加算値 */
export function additiveBonus(type, element, em, level, bonus = 0) {
  const base = REACTIONS[type]?.kind === 'add' ? REACTIONS[type].elements[element] : null;
  if (!base) return 0;
  return base * levelMultiplier(level) * (1 + (5 * em) / (em + 1200) + bonus);
}

/** 敵の該当属性の最終耐性 */
export function enemyRes(enemy, mods, element) {
  const base = enemy.res?.[element] ?? enemy.baseRes ?? 0.1;
  return base - m(mods, `res.${element}`) - m(mods, 'res.all');
}

/**
 * 1ヒット（1種類のヒット×回数）のダメージ
 * @param {object} hit { stat, mult, count, element, category, rowMod }
 * @param {object} env { stats, mods, level, enemy, reaction:{type, rate} }
 * @returns {{nonCrit:number, crit:number, avg:number, reacted:boolean}}
 */
export function calcHit(hit, env) {
  const { stats, mods, level, enemy } = env;
  const rm = hit.rowMod ?? {};
  const el = hit.element;
  const cat = hit.category;
  const statValue = stats[hit.stat] ?? 0;
  const mult = (hit.mult + (rm.multAdd ?? 0)) * (rm.multScale ?? 1);
  // 月反応・星反応ダメージ（概算）: 防御無視・通常のダメージバフは乗らず、専用バフ（dmg.lunar など）のみ
  const special = hit.special ?? null;
  const flat = special ? 0 : m(mods, `flat.${cat}`) + m(mods, `flat.${el}`) + m(mods, 'flat.all');
  const bonus = special
    ? 1 + m(mods, `dmg.${special}`) + (rm.dmg ?? 0)
    : 1 + m(mods, 'dmg') + (stats.dmg[el] ?? 0) + m(mods, `dmg.${cat}`) + (rm.dmg ?? 0);
  const cr = Math.min(1, Math.max(0, stats.cr + m(mods, `cr.${cat}`) + (rm.cr ?? 0)));
  const cd = stats.cd + m(mods, `cd.${cat}`) + (rm.cd ?? 0);
  const defMult = special ? 1 : defMultiplier(level, enemy.level, m(mods, 'defRed'), m(mods, 'defIgnore') + (rm.defIgnore ?? 0));
  const resMult = resMultiplier(enemyRes(enemy, mods, el));

  const calc = (reactionType) => {
    const add = reactionType ? additiveBonus(reactionType, el, stats.em, level, m(mods, `react.${reactionType}`)) : 0;
    const amp = reactionType ? ampMultiplier(reactionType, el, stats.em, m(mods, `react.${reactionType}`)) : 1;
    const nonCrit = (mult * statValue + flat + add) * bonus * defMult * resMult * amp;
    return { nonCrit, crit: nonCrit * (1 + cd), avg: nonCrit * (1 + cr * cd) };
  };

  const type = hit.reaction?.type ?? 'none';
  const rate = Math.min(1, Math.max(0, hit.reaction?.rate ?? 1));
  const plain = calc(null);
  let result = plain;
  let reacted = false;
  if (!special && type !== 'none' && reactionApplies(type, el) && rate > 0) {
    const r = calc(type);
    reacted = true;
    // 反応率に応じた期待値（非会心・会心は反応時の値を表示）
    result = {
      nonCrit: r.nonCrit,
      crit: r.crit,
      avg: plain.avg * (1 - rate) + r.avg * rate,
    };
  }
  const n = hit.count ?? 1;
  return { nonCrit: result.nonCrit * n, crit: result.crit * n, avg: result.avg * n, reacted, cr, cd };
}
