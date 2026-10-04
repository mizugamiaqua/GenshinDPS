// キャラデータ・ビルド・設定から、ステータスとダメージ計算環境を組み立てる。
import { ARTIFACT_SETS, CUSTOM_BUFF, TEAM_BUFFS, activeSetBuffs, addEffects, isBuffOn, resolveParams } from './buffs.js';
import { buildActions, actionMap } from './actions.js';
import { calcHit, computeStats } from './damage.js';
import { profileFor } from './profiles.js';

export const DEFAULT_SETTINGS = Object.freeze({
  buffs: {},
  enemy: { level: 100, res: 10 },
  reaction: { type: 'none', rate: 100 },
  infusion: 'auto',
  talentOverride: {},
  rotationLength: null,
});

export function normalizeSettings(s = {}) {
  return {
    buffs: { ...(s.buffs ?? {}) },
    enemy: { ...DEFAULT_SETTINGS.enemy, ...(s.enemy ?? {}) },
    reaction: { ...DEFAULT_SETTINGS.reaction, ...(s.reaction ?? {}) },
    infusion: s.infusion ?? 'auto',
    talentOverride: { ...(s.talentOverride ?? {}) },
    rotationLength: s.rotationLength ?? null,
  };
}

function makeCtx(charData, build, settings) {
  const talentLevels = { ...build.talentLevels };
  for (const [k, v] of Object.entries(settings.talentOverride ?? {})) {
    if (v) talentLevels[k] = Number(v);
  }
  const ctx = {
    key: charData.key,
    element: charData.element,
    weaponType: charData.weaponType,
    constellation: build.constellation ?? 0,
    level: build.level ?? 90,
    talentLevels,
    /** 天賦の補助数値（攻撃力アップ量など）を現在の天賦レベルで取得 */
    talentValue(talent, re, paramIdx = 0) {
      const ex = charData.talents[talent]?.extras?.find((e) => re.test(e.nameEn));
      const arr = ex?.params?.[paramIdx] ?? (paramIdx === 0 ? ex?.values : null);
      if (!arr) return 0;
      const lv = Math.min(arr.length, Math.max(1, talentLevels[talent] ?? 1));
      return arr[lv - 1];
    },
  };
  return ctx;
}

/** 表示・計算対象となるバフ定義の一覧（グループ付き） */
export function listBuffs(charData, build, ctx, { manualTeamBuffs = true } = {}) {
  const profile = profileFor(charData);
  const groups = [];
  for (const def of profile?.buffs ?? []) {
    if (def.available && !def.available(ctx)) continue;
    // 他メンバーを強化する効果は、チーム編成時はチームバフ側で扱う
    if (def.soloOnly && !manualTeamBuffs) continue;
    groups.push({ def, group: 'profile', fallbackOn: true });
  }
  for (const def of activeSetBuffs(build, ctx)) groups.push({ def, group: 'set', fallbackOn: true });
  // チーム編成モードでは、手入力のチームバフの代わりに実際のメンバーから計算したバフを使う
  if (manualTeamBuffs) for (const def of TEAM_BUFFS) groups.push({ def, group: 'team', fallbackOn: false });
  groups.push({ def: CUSTOM_BUFF, group: 'custom', fallbackOn: true });
  return groups;
}

/**
 * 計算エンジンを作る
 * @param {object} charData characters.json の1キャラ
 * @param {object} build 正規化済みビルド（enka.js の parseAvatar の結果）
 * @param {object} rawSettings ユーザー設定
 * @param {{teamBuffs?:Array<{def:object, params:object}>}} opts
 *   teamBuffs チームメイトから受けるバフ（指定時は手入力のチームバフ一覧を使わない）
 */
export function createEngine(charData, build, rawSettings, opts = {}) {
  const settings = normalizeSettings(rawSettings);
  const ctx = makeCtx(charData, build, settings);
  const teamMode = Array.isArray(opts.teamBuffs);
  const buffList = listBuffs(charData, build, ctx, { manualTeamBuffs: !teamMode }).map((b) => ({
    ...b,
    on: isBuffOn(b.def, settings.buffs, b.fallbackOn),
    params: resolveParams(b.def, settings.buffs[b.def.id]?.params),
  }));
  for (const tb of opts.teamBuffs ?? []) buffList.push({ def: tb.def, group: 'teamlink', on: true, params: tb.params ?? {} });
  const enabled = buffList.filter((b) => b.on);

  // 1) 静的効果 → 2) ステータス確定後の動的効果（変換系）
  const mods = {};
  for (const b of enabled) if (b.def.effects) addEffects(mods, b.def.effects(b.params, ctx));
  const preStats = computeStats(build.panel, mods);
  for (const b of enabled) if (b.def.dynamic) addEffects(mods, b.def.dynamic(b.params, preStats, ctx));
  const stats = computeStats(build.panel, mods);

  const rowMods = enabled.flatMap((b) => (b.def.rowMods ? b.def.rowMods(b.params, ctx, stats) : []));

  const actions = buildActions(charData, { talentLevels: ctx.talentLevels, infusion: settings.infusion });
  const byId = actionMap(actions);

  const enemy = {
    level: Number(settings.enemy.level) || 100,
    baseRes: (Number(settings.enemy.res) || 0) / 100,
  };
  const globalReaction = { type: settings.reaction.type, rate: (Number(settings.reaction.rate) || 0) / 100 };
  const env = { stats, mods, level: ctx.level, enemy };

  function rowModFor(action) {
    const out = {};
    for (const rm of rowMods) {
      if (rm.talent && rm.talent !== action.talent) continue;
      if (rm.match && !rm.match.test(action.nameEn)) continue;
      for (const k of ['multAdd', 'dmg', 'cr', 'cd', 'defIgnore']) {
        if (rm[k]) out[k] = (out[k] ?? 0) + rm[k];
      }
      if (rm.multScale) out.multScale = (out.multScale ?? 1) * rm.multScale;
    }
    return out;
  }

  /**
   * アクション1回分のダメージ
   * @param {object|string} actionOrId
   * @param {'auto'|'none'|string} reaction 'auto' は全体設定に従う
   */
  function damageOf(actionOrId, reaction = 'auto') {
    const action = typeof actionOrId === 'string' ? byId[actionOrId] : actionOrId;
    if (!action) return null;
    const rx = reaction === 'auto' ? globalReaction : reaction === 'none' ? { type: 'none', rate: 0 } : { type: reaction, rate: 1 };
    const rowMod = rowModFor(action);
    const total = { nonCrit: 0, crit: 0, avg: 0, reacted: false };
    const hits = action.hits.map((h) => {
      const r = calcHit({ ...h, rowMod, reaction: rx }, env);
      total.nonCrit += r.nonCrit;
      total.crit += r.crit;
      total.avg += r.avg;
      total.reacted ||= r.reacted;
      return { ...h, ...r };
    });
    return { ...total, hits };
  }

  return { charData, build, settings, ctx, stats, mods, rowMods, buffs: buffList, actions, byId, env, damageOf };
}

export { ARTIFACT_SETS };
