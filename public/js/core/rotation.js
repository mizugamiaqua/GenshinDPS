// コンボ（ローテーション）の評価と、推奨コンボの自動生成。
import { ACTION_TIMING, CATEGORY_JA } from './constants.js';
import { profileFor } from './profiles.js';

/**
 * コンボを評価する
 * @param {object} engine createEngine の戻り値
 * @param {{entries:Array<{actionId:string,count:number,time?:number,reaction?:string}>, duration?:number|null}} combo
 */
export function evaluateCombo(engine, combo) {
  const lines = [];
  let totalDamage = 0;
  let totalTime = 0;
  const byCategory = {};
  for (const entry of combo.entries ?? []) {
    const action = engine.byId[entry.actionId];
    const count = Math.max(0, Number(entry.count ?? 1));
    if (!action) {
      lines.push({ entry, action: null, missing: true, total: 0, time: 0 });
      continue;
    }
    const per = engine.damageOf(action, entry.reaction ?? 'auto');
    const perTime = entry.time ?? action.defaultTime;
    const total = per.avg * count;
    const time = perTime * count;
    totalDamage += total;
    totalTime += time;
    if (action.category) byCategory[action.category] = (byCategory[action.category] ?? 0) + total;
    lines.push({ entry, action, per, perTime, count, total, time });
  }
  const duration = combo.duration > 0 ? Number(combo.duration) : totalTime;
  return {
    lines,
    totalDamage,
    totalTime,
    duration,
    dps: duration > 0 ? totalDamage / duration : 0,
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// 推奨コンボ生成
// ---------------------------------------------------------------------------

/**
 * 同時には選ばない行（低空/高空、通常時/低HP時など）をまとめ、ダメージが最大のものを選ぶ
 */
function pickAlternatives(rows, dmg) {
  const groups = [];
  for (const r of rows) {
    const g = groups.find((grp) => grp.some((x) =>
      x.rowIndex === r.rowIndex
      || r.baseNameEn.endsWith(` ${x.baseNameEn}`)
      || x.baseNameEn.endsWith(` ${r.baseNameEn}`)));
    if (g) g.push(r);
    else groups.push([r]);
  }
  return groups.map((g) => g.reduce((best, r) => (dmg(r) > dmg(best) ? r : best)));
}

/**
 * 重撃の選択肢（両手剣の「連続重撃＋重撃終了」は1セットとして扱う）
 * @returns {Array<Array<object>>}
 */
function chargedOptions(chargedRows) {
  const spin = chargedRows.find((r) => /Spinning|Cyclic/i.test(r.nameEn));
  const final = chargedRows.find((r) => /Final/i.test(r.nameEn) && r.talent === spin?.talent);
  if (spin && final) {
    return [[spin, final], ...chargedRows.filter((r) => r !== spin && r !== final).map((r) => [r])];
  }
  return chargedRows.map((r) => [r]);
}

/**
 * 通常攻撃（または特殊状態の攻撃）のパターン候補
 * 近接武器はスタミナの都合で「重撃だけの連打」を候補にしない
 */
function fillerCandidates(chainRows, chargedRows, dmg, { allowChargedOnly = true } = {}) {
  const chain = [...new Map(chainRows.filter((r) => r.chain).sort((a, b) => a.chain - b.chain).map((r) => [r.chain, r])).values()];
  const cands = [];
  const sum = (rows) => rows.reduce((s, r) => s + dmg(r), 0);
  const time = (rows) => rows.reduce((s, r) => s + r.defaultTime, 0);
  const options = chargedOptions(chargedRows);
  for (let k = 0; k <= chain.length; k++) {
    const prefix = chain.slice(0, k);
    if (k > 0) cands.push({ rows: prefix, damage: sum(prefix), time: time(prefix) });
    if (k === 0 && !allowChargedOnly && chain.length) continue;
    for (const opt of options) {
      const rows = [...prefix, ...opt];
      cands.push({ rows, damage: sum(rows), time: time(rows) });
    }
  }
  return cands
    .filter((c) => c.time > 0)
    .map((c) => ({ ...c, dps: c.damage / c.time }))
    .sort((a, b) => b.dps - a.dps);
}

function patternLabel(rows) {
  return rows.map((r) => r.nameJa.replace(/ダメージ$/, '')).join('→');
}

function cooldownOf(engine, talent, re = null) {
  const t = engine.charData.talents[talent];
  const lv = engine.ctx.talentLevels[talent] ?? 1;
  if (re) {
    const ex = t.extras?.find((e) => re.test(e.nameEn));
    if (ex?.values) return ex.values[Math.min(ex.values.length, lv) - 1];
  }
  return t.cooldown ? t.cooldown[Math.min(t.cooldown.length, lv) - 1] : null;
}

function durationOf(engine, talent) {
  const t = engine.charData.talents[talent];
  const lv = engine.ctx.talentLevels[talent] ?? 1;
  if (t.duration) return t.duration[Math.min(t.duration.length, lv) - 1];
  const ex = t.extras?.find((e) => /Duration$/i.test(e.nameEn) && !/Extension|CD/i.test(e.nameEn));
  return ex?.values ? ex.values[Math.min(ex.values.length, lv) - 1] : null;
}

/**
 * 推奨コンボを生成する（行動のタイムラインを組み立て、そこからコンボを作る）
 *
 * role = 'main'（フィールドで戦う）:
 *   元素スキル → 元素爆発 → 特殊状態中の攻撃 → 通常攻撃パターン …（CDが明けたら元素スキルを再使用）
 *   使える時間は fieldBudget（チーム時）または rotationLength
 * role = 'support'（控えから支援）:
 *   元素スキル・元素爆発（順番はプロファイル指定）と、その後の控えでの継続ダメージだけ
 *
 * @param {object} engine
 * @param {{rotationLength?:number, role?:'main'|'support', fillNormal?:boolean, fieldBudget?:number, fillState?:boolean}} opts
 */
export function recommendCombo(engine, opts = {}) {
  const { charData, actions, byId } = engine;
  const profile = profileFor(charData) ?? {};
  const dmgCache = new Map();
  const dmg = (a) => {
    if (!dmgCache.has(a.id)) dmgCache.set(a.id, engine.damageOf(a).avg);
    return dmgCache.get(a.id);
  };
  const hitCounts = profile.hitCounts ? profile.hitCounts(engine.ctx) : {};
  const countOf = (r, fallback) => hitCounts[r.baseNameEn] ?? hitCounts[r.nameEn] ?? fallback;
  // 役割: 控え中心のキャラ（profile.support）は support、それ以外は main。fillNormal は main のときだけ意味を持つ
  const role = opts.role ?? (opts.fillNormal === false || profile.support ? 'support' : 'main');
  const fillNormal = role === 'main' && (opts.fillNormal ?? profile.fillNormal ?? true);

  const burstCd = cooldownOf(engine, 'burst');
  const L = Number(opts.rotationLength) || profile.rotationLength
    || (burstCd ? Math.min(25, Math.max(12, burstCd)) : 20);
  const budget = role === 'main' ? (opts.fieldBudget != null ? opts.fieldBudget : L) : Infinity;
  const skillName = charData.talents.skill?.name ?? '';
  const burstName = charData.talents.burst?.name ?? '';
  const notes = [...(profile.notes ?? [])];
  const alternatives = [];

  // --- 元素スキルの1回分 ---
  const skillRows = actions.filter((a) => a.talent === 'skill' && ['press', 'hold', 'other'].includes(a.kind));
  const press = skillRows.filter((a) => a.kind === 'press');
  const hold = skillRows.filter((a) => a.kind === 'hold');
  const common = pickAlternatives(skillRows.filter((a) => a.kind === 'other'), dmg);
  let skillCd = cooldownOf(engine, 'skill');
  let mode = null;
  if (press.length && hold.length) {
    const pressCd = cooldownOf(engine, 'skill', /^(Press|Tap) CD$/i) ?? skillCd;
    const holdCd = cooldownOf(engine, 'skill', /^Hold CD$/i) ?? skillCd;
    const bestPress = pickAlternatives(press, dmg)[0];
    const bestHold = pickAlternatives(hold, dmg)[0];
    const span = role === 'main' ? Math.min(L, budget) : L;
    const casts = (cd) => profile.skillCasts ?? Math.max(1, Math.ceil(span / (cd || span) - 1e-9));
    mode = casts(holdCd) * dmg(bestHold) > casts(pressCd) * dmg(bestPress)
      ? { row: bestHold, cd: holdCd, label: '長押し' }
      : { row: bestPress, cd: pressCd, label: '単押し' };
    skillCd = mode.cd;
  } else if (press.length || hold.length) {
    const row = pickAlternatives([...press, ...hold], dmg)[0];
    mode = { row, cd: skillCd, label: row.kind === 'hold' ? '長押し' : '単押し' };
  }
  // 継続時間のある特殊状態（雷電の夢想の一心、フリンズの顕現の炎など）
  const stateTalent = profile.stateTalent
    ?? ['burst', 'skill'].find((t) => actions.some((a) => a.talent === t && a.kind === 'chain') && durationOf(engine, t));
  // 特殊状態ではないスキル内の連撃（ディルックの3段斬りなど）は1回の発動に含める
  const skillChain = stateTalent === 'skill' ? [] : actions.filter((a) => a.talent === 'skill' && a.kind === 'chain');
  const castRows = mode ? [{ action: mode.row, count: 1 }]
    : skillChain.length ? skillChain.map((r) => ({ action: r, count: 1 }))
      : [{ action: byId['cast:skill'], count: 1 }];
  const skillCastTime = castRows.reduce((s, r) => s + r.action.defaultTime * r.count, 0);
  const skillLabel = `元素スキル「${skillName}」${mode && press.length && hold.length ? `（${mode.label}）` : ''}`;

  // --- 元素爆発 ---
  const burstRows = pickAlternatives(actions.filter((a) => a.talent === 'burst' && ['press', 'hold', 'other'].includes(a.kind)), dmg);
  const burstCastTime = byId['cast:burst'].defaultTime;

  // --- タイムライン ---
  const timeline = [];
  let t = 0;
  let skillCasts = 0;
  let lastSkill = -Infinity;
  const push = (label, rows, kind, pattern = null) => {
    const time = rows.reduce((s, r) => s + (r.time ?? r.action.defaultTime) * r.count, 0);
    const last = timeline[timeline.length - 1];
    if (pattern && last?.pattern && last.pattern.key === pattern.key) {
      // 同じ攻撃パターンが続く場合は1つにまとめる（[1段→重撃] ×8 など）
      last.pattern.n += pattern.n;
      last.label = `${pattern.title}: [${pattern.text}]${last.pattern.n > 1 ? ` ×${last.pattern.n}` : ''}`;
      rows.forEach((r, i) => { last.rows[i].count += r.count; });
      last.time += time;
    } else {
      timeline.push({ label, kind, start: t, time, rows, pattern });
    }
    t += time;
  };
  const castSkill = (suffix = '') => {
    push(skillLabel + suffix, castRows, 'skill');
    skillCasts++;
    lastSkill = t - skillCastTime;
  };
  const castBurst = () => {
    const rows = [{ action: byId['cast:burst'], count: 1 }, ...burstRows.map((r) => ({ action: r, count: countOf(r, 1), time: 0 }))];
    push(`元素爆発「${burstName}」`, rows.filter((r) => r.count > 0), 'burst');
  };

  const allowChargedOnly = ['WEAPON_CATALYST', 'WEAPON_BOW'].includes(charData.weaponType);
  const candidatesFor = (talent, title) => {
    const chainRows = actions.filter((a) => a.talent === talent && a.kind === 'chain');
    const chargedRows = actions.filter((a) => a.talent === talent && a.kind === 'charged');
    let cands = fillerCandidates(chainRows, chargedRows, dmg, { allowChargedOnly });
    if (profile.pattern && talent === 'normal') {
      const p = profile.pattern;
      const chain = chainRows.filter((r) => r.chain && r.chain <= p.chain).sort((a, b) => a.chain - b.chain);
      const cas = [].concat(p.charged ?? []).map((n) => chargedRows.find((r) => r.baseNameEn === n)).filter(Boolean);
      const rows = [...chain, ...cas];
      const damage = rows.reduce((s, r) => s + dmg(r), 0);
      cands = [{ rows, damage, time: p.time, dps: damage / p.time, fixed: true }, ...cands];
    }
    if (cands.length) alternatives.push({ title, candidates: cands.slice(0, 4).map((c) => ({ label: patternLabel(c.rows), dps: c.dps, time: c.time })) });
    return cands;
  };
  const patternRows = (c, n) => (c.fixed
    ? c.rows.map((r) => ({ action: r, count: n, time: Math.round((c.time / c.rows.length) * 100) / 100 }))
    : c.rows.map((r) => ({ action: r, count: n })));
  /** seconds 秒を攻撃パターンで埋める（stopAt を返すと途中で打ち切り） */
  const fillWith = (cands, seconds, title, { recastSkill = false } = {}) => {
    if (!cands.length) return;
    const end = t + seconds;
    const best = cands[0];
    while (end - t > 0.2) {
      if (recastSkill && skillCd && skillCasts < maxCasts && t - lastSkill >= skillCd && t + skillCastTime <= end) {
        castSkill('（CD明け）');
        continue;
      }
      const left = end - t;
      const nextSkill = recastSkill && skillCd && skillCasts < maxCasts ? Math.max(0, lastSkill + skillCd - t) : Infinity;
      // 最適パターンが入るなら続ける（スキル再使用は少し遅らせてよい）。入らない端数だけ短いパターンで埋める
      const pick = best.time <= left + 1e-6 ? best : cands.find((c) => c.time <= left + 1e-6);
      if (!pick) break;
      const window = Math.min(left, nextSkill > 0.05 ? nextSkill : left);
      const n = pick === best ? Math.max(1, Math.floor(window / pick.time + 1e-6)) : 1;
      const text = patternLabel(pick.rows);
      push(`${title}: [${text}]${n > 1 ? ` ×${n}` : ''}`, patternRows(pick, n), 'attack', { key: `${title}|${text}`, n, title, text });
      if (best.fixed && pick !== best) break;
    }
  };

  let maxCasts = 1;
  if (role === 'support') {
    // 控えのキャラは自分の番にスキル・爆発を使ってすぐ交代する
    const order = profile.burstFirst ? ['burst', 'skill'] : ['skill', 'burst'];
    const casts = profile.skillCasts ?? 1;
    for (const step of order) {
      if (step === 'skill') for (let i = 0; i < casts; i++) castSkill(i ? '（2回目）' : '');
      else castBurst();
    }
  } else {
    maxCasts = profile.skillCasts ?? Math.max(1, Math.ceil(Math.min(L, budget) / (skillCd || L) - 1e-9));
    const burstLast = !!profile.burstLast;
    if (profile.burstFirst) castBurst();
    castSkill();
    if (!profile.burstFirst && !burstLast) castBurst();
    if (stateTalent && opts.fillState !== false) {
      const D0 = profile.stateDuration ?? durationOf(engine, stateTalent) ?? 7;
      const D = Math.min(D0, Math.max(0, budget - t - (burstLast ? burstCastTime : 0)));
      fillWith(candidatesFor(stateTalent, `${CATEGORY_JA[stateTalent]}中の攻撃`), D, `${CATEGORY_JA[stateTalent]}の特殊状態中`);
      if (D > 0) notes.push(`${CATEGORY_JA[stateTalent]}の特殊状態（約${Math.round(D0 * 10) / 10}秒）中は専用の攻撃に置き換わるため、その間の最適パターンを選びました。`);
    }
    if (fillNormal) {
      const reserve = burstLast ? burstCastTime : 0;
      const rest = Math.max(0, budget - t - reserve);
      const seconds = profile.fillDuration != null ? Math.min(profile.fillDuration, rest) : rest;
      const cands = candidatesFor('normal', '通常攻撃');
      fillWith(cands, seconds, '通常攻撃', { recastSkill: !profile.skillCasts });
      if (cands.length) notes.push(`通常攻撃は「${patternLabel(cands[0].rows)}」が最もDPS効率が高い（${Math.round(cands[0].dps).toLocaleString()}/秒）と判定しました。モーション時間は武器種ごとの目安値です。`);
    }
    if (burstLast) castBurst();
  }

  // 元素スキルで出る設置物・継続ダメージ（グゥオパァー、サロンメンバーなど）
  if (common.length) {
    const rows = common.map((r) => ({ action: r, count: countOf(r, skillCasts), time: 0 })).filter((r) => r.count > 0);
    const skillStep = timeline.find((s) => s.kind === 'skill');
    if (skillStep && rows.length) skillStep.rows.push(...rows);
  }
  if (skillCd && role === 'main') notes.push(`元素スキルのCDは${skillCd}秒。使えるフィールド時間（約${Math.round(Math.min(L, budget) * 10) / 10}秒）の中で${skillCasts}回使用します。`);
  if (!profile.hitCounts && (burstRows.length > 1 || common.length)) {
    notes.push('持続ダメージ（設置物・継続攻撃）のヒット数はキャラによって異なるため、1回として計算しています。必要に応じて回数を調整してください。');
  }

  // タイムライン → コンボ（同じ行動・同じ時間はまとめる）
  const entries = [];
  for (const step of timeline) {
    for (const r of step.rows) {
      if (!r.action || r.count <= 0) continue;
      const time = r.time ?? r.action.defaultTime;
      const ex = entries.find((e) => e.actionId === r.action.id && e.time === time);
      if (ex) ex.count += r.count;
      else entries.push({ actionId: r.action.id, count: r.count, time, reaction: 'auto' });
    }
  }
  // 控えで戦うキャラ（プロファイルでローテ秒数指定あり）は、その秒数でDPSを割る
  const duration = profile.rotationLength ?? (Number(opts.rotationLength) || null);
  return {
    combo: { entries, duration },
    role,
    rotationLength: L,
    fieldTime: t,
    timeline: timeline.map((s) => ({ label: s.label, start: Math.round(s.start * 100) / 100, time: Math.round(s.time * 100) / 100, kind: s.kind })),
    sequence: timeline.map((s) => s.label).join(' → '),
    notes,
    alternatives,
  };
}

export { ACTION_TIMING };
