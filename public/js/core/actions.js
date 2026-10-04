// 天賦データ → コンボで選択できる「アクション」一覧を作る。
// 各アクションには、ヒットごとの元素・倍率と、モーション時間の目安が付く。
import { ACTION_TIMING, WEAPON_TIMING } from './constants.js';
import { ELEMENT_OVERRIDES, hasInfusion } from './profiles.js';

export const PRESS_RE = /\b(Press|Tap|Short)\b/i;
export const HOLD_RE = /\b(Hold|Long)\b/i;
const CHAIN_RE = /(\d+)-Hit\b/i;

/** 行の種類: chain(通常攻撃の段) / charged / plunge / press / hold / other */
export function rowKind(row) {
  if (row.category === 'plunge' || /Plung/i.test(row.nameEn)) return 'plunge';
  if (row.category === 'charged' || /Charged Attack|Aimed Shot/i.test(row.nameEn)) return 'charged';
  if (CHAIN_RE.test(row.nameEn) && !/Swing/i.test(row.nameEn)) return 'chain';
  if (row.category === 'normal') return 'chain';
  if (PRESS_RE.test(row.nameEn)) return 'press';
  if (HOLD_RE.test(row.nameEn)) return 'hold';
  return 'other';
}

function chainIndex(row) {
  const m = CHAIN_RE.exec(row.nameEn);
  return m ? Number(m[1]) : null;
}

/** ヒットの元素を決める */
function hitElement(row, hit, charData, infusion) {
  if (hit.element) return hit.element;
  const override = ELEMENT_OVERRIDES[charData.key]?.[row.talent]?.[row.nameEn.replace(/ \[.*\]$/, '')];
  if (override) return override;
  if (row.talent !== 'normal') return charData.element;
  if (infusion) return charData.element;
  const base = row.nameEn.replace(/ \[.*\]$/, '');
  if (charData.weaponType === 'WEAPON_BOW' && row.category === 'charged') {
    // 狙い撃ち（ノンチャージ）だけ物理、チャージ狙い撃ちは元素
    return /^Aimed Shot$/i.test(base) ? 'physical' : charData.element;
  }
  // 通常攻撃天賦の特殊行（断流・霜華の矢など）は元素ダメージ
  const standard = /Hit DMG|^Charged Attack|Plung|^Aimed Shot$/i.test(base);
  return standard ? 'physical' : charData.element;
}

/** モーション時間の目安（秒） */
function defaultTime(row, kind, charData, firstOfTalent) {
  const wt = WEAPON_TIMING[charData.weaponType] ?? WEAPON_TIMING.WEAPON_SWORD_ONE_HAND;
  switch (kind) {
    case 'chain':
      return wt.hit;
    case 'charged':
      if (/^Aimed Shot$/i.test(row.nameEn)) return 0.55;
      if (/Spinning|Cyclic/i.test(row.nameEn)) return 0.5;
      if (/Final/i.test(row.nameEn) && charData.weaponType === 'WEAPON_CLAYMORE') return 0.7;
      if (/Charge Level 1/i.test(row.nameEn)) return 1.0;
      return wt.charged;
    case 'plunge':
      return /^Plunge DMG$/i.test(row.nameEn) ? 0 : ACTION_TIMING.plunge;
    case 'press':
      return ACTION_TIMING.skillPress;
    case 'hold':
      return ACTION_TIMING.skillHold;
    default:
      if (!firstOfTalent) return 0;
      return row.talent === 'burst' ? ACTION_TIMING.burst : ACTION_TIMING.skillPress;
  }
}

/**
 * アクション一覧を生成
 * @param {object} charData characters.json の1キャラ
 * @param {object} opts { talentLevels, infusion:'auto'|'on'|'off' }
 */
export function buildActions(charData, opts = {}) {
  const infusion = hasInfusion(charData, opts.infusion);
  const actions = [];
  for (const talent of ['normal', 'skill', 'burst']) {
    const t = charData.talents[talent];
    const lv = opts.talentLevels?.[talent] ?? 10;
    const hasPressHold = t.rows.some((r) => ['press', 'hold'].includes(rowKind(r)));
    let firstOther = true;
    for (const row of t.rows) {
      const kind = rowKind(row);
      const isFirst = kind === 'other' && firstOther && !hasPressHold;
      if (kind === 'other') firstOther = false;
      actions.push({
        id: row.id,
        talent,
        category: row.category,
        kind,
        chain: kind === 'chain' ? chainIndex(row) : null,
        nameJa: row.nameJa,
        nameEn: row.nameEn,
        baseNameEn: row.nameEn.replace(/ \[.*\]$/, ''),
        rowIndex: Number(row.id.split(':')[1]),
        defaultTime: defaultTime(row, kind, charData, isFirst),
        hits: row.hits.map((h) => ({
          stat: h.stat,
          count: h.count,
          mult: h.values[Math.min(h.values.length, Math.max(1, lv)) - 1],
          element: hitElement(row, h, charData, infusion),
          category: row.category,
        })),
      });
    }
  }
  // ダメージの無い行動（キャスト・移動）
  actions.push(
    { id: 'cast:skill', talent: 'skill', category: 'skill', kind: 'cast', nameJa: '元素スキル発動（ダメージなし）', nameEn: 'Skill cast', defaultTime: ACTION_TIMING.skillPress, hits: [] },
    { id: 'cast:burst', talent: 'burst', category: 'burst', kind: 'cast', nameJa: '元素爆発発動（ダメージなし）', nameEn: 'Burst cast', defaultTime: ACTION_TIMING.burst, hits: [] },
    { id: 'wait', talent: null, category: null, kind: 'wait', nameJa: '移動・待機・ダッシュ', nameEn: 'Wait', defaultTime: 1, hits: [] },
  );
  return actions;
}

export function actionMap(actions) {
  return Object.fromEntries(actions.map((a) => [a.id, a]));
}
