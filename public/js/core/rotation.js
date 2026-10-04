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
 * 推奨コンボを生成する
 * 方針:
 *   1. 元素爆発を1回（ダメージ行は択一のものから最大を選択）
 *   2. 元素スキルをローテーション中にCDが許す回数（単押し/長押しはDPS効率の高い方）
 *   3. 特殊状態（雷電の夢想の一心など）があればその間の攻撃パターンを最適化
 *   4. 残り時間を「通常N段＋重撃」の中で最もDPS効率が高いパターンで埋める
 * @param {object} engine
 * @param {{rotationLength?:number}} opts
 */
export function recommendCombo(engine, opts = {}) {
  const { charData, actions } = engine;
  const profile = profileFor(charData) ?? {};
  const dmgCache = new Map();
  const dmg = (a) => {
    if (!dmgCache.has(a.id)) dmgCache.set(a.id, engine.damageOf(a).avg);
    return dmgCache.get(a.id);
  };
  const hitCounts = profile.hitCounts ? profile.hitCounts(engine.ctx) : {};

  const burstCd = cooldownOf(engine, 'burst');
  const L = Number(opts.rotationLength) || profile.rotationLength
    || (burstCd ? Math.min(25, Math.max(12, burstCd)) : 20);

  const entries = [];
  const steps = [];
  const notes = [...(profile.notes ?? [])];
  let used = 0;
  const add = (action, count, time = action.defaultTime) => {
    if (!action || count <= 0) return;
    const existing = entries.find((e) => e.actionId === action.id && e.time === time);
    if (existing) existing.count += count;
    else entries.push({ actionId: action.id, count, time, reaction: 'auto' });
    used += time * count;
  };
  const byId = engine.byId;

  // --- 1. 元素スキル ---
  const skillRows = actions.filter((a) => a.talent === 'skill' && ['press', 'hold', 'other'].includes(a.kind));
  const press = skillRows.filter((a) => a.kind === 'press');
  const hold = skillRows.filter((a) => a.kind === 'hold');
  const common = pickAlternatives(skillRows.filter((a) => a.kind === 'other'), dmg);
  let skillMode = null;
  let skillCd = cooldownOf(engine, 'skill');
  if (press.length && hold.length) {
    const pressCd = cooldownOf(engine, 'skill', /^(Press|Tap) CD$/i) ?? skillCd;
    const holdCd = cooldownOf(engine, 'skill', /^Hold CD$/i) ?? skillCd;
    const bestPress = pickAlternatives(press, dmg)[0];
    const bestHold = pickAlternatives(hold, dmg)[0];
    // ローテーション全体で与えられるダメージで比較
    const casts = (cd) => profile.skillCasts ?? Math.ceil(L / (cd || L) - 1e-9);
    const pressTotal = casts(pressCd) * dmg(bestPress);
    const holdTotal = casts(holdCd) * dmg(bestHold);
    skillMode = holdTotal > pressTotal ? { row: bestHold, cd: holdCd, label: '長押し' } : { row: bestPress, cd: pressCd, label: '単押し' };
    skillCd = skillMode.cd;
  } else if (press.length || hold.length) {
    const row = pickAlternatives([...press, ...hold], dmg)[0];
    skillMode = { row, cd: skillCd, label: row.kind === 'hold' ? '長押し' : '単押し' };
  }
  const skillCasts = profile.skillCasts ?? Math.max(1, Math.ceil(L / (skillCd || L) - 1e-9));
  // 特殊状態（継続時間あり）が無いスキル内の連撃（ディルックの3段斬りなど）は1回の発動に含める
  const stateTalent = profile.stateTalent
    ?? ['burst', 'skill'].find((t) => actions.some((a) => a.talent === t && a.kind === 'chain') && durationOf(engine, t));
  const skillChain = stateTalent === 'skill' ? [] : actions.filter((a) => a.talent === 'skill' && a.kind === 'chain');
  if (skillMode) {
    add(skillMode.row, skillCasts);
  } else if (skillChain.length) {
    for (const r of skillChain) add(r, skillCasts);
  } else {
    add(byId['cast:skill'], skillCasts);
  }
  for (const r of common) {
    add(r, hitCounts[r.baseNameEn] ?? hitCounts[r.nameEn] ?? skillCasts, 0);
  }
  steps.push(`元素スキル${skillMode ? `（${skillMode.label}）` : ''} ×${skillCasts}`);
  if (skillCd) notes.push(`元素スキルのCDは${skillCd}秒。${L}秒のローテーションで${skillCasts}回使用します。`);

  // --- 2. 元素爆発 ---
  const burstRows = pickAlternatives(actions.filter((a) => a.talent === 'burst' && ['press', 'hold', 'other'].includes(a.kind)), dmg);
  add(byId['cast:burst'], 1);
  for (const r of burstRows) add(r, hitCounts[r.baseNameEn] ?? hitCounts[r.nameEn] ?? 1, 0);
  steps.push('元素爆発');
  if (burstRows.length && !profile.hitCounts) {
    notes.push('持続ダメージ（設置物・継続攻撃）のヒット数はキャラによって異なるため、1回として計算しています。必要に応じて回数を調整してください。');
  }

  // --- 3. 特殊状態中の攻撃 ---
  const alternatives = [];
  const allowChargedOnly = ['WEAPON_CATALYST', 'WEAPON_BOW'].includes(charData.weaponType);
  const fill = (seconds, chainRows, chargedRows, title) => {
    let cands = fillerCandidates(chainRows, chargedRows, dmg, { allowChargedOnly });
    if (profile.pattern && title === '通常攻撃') {
      const p = profile.pattern;
      const names = [].concat(p.charged ?? []);
      const chain = chainRows.filter((r) => r.chain && r.chain <= p.chain).sort((a, b) => a.chain - b.chain);
      const cas = names.map((n) => chargedRows.find((r) => r.baseNameEn === n)).filter(Boolean);
      const rows = [...chain, ...cas];
      const damage = rows.reduce((s, r) => s + dmg(r), 0);
      cands = [{ rows, damage, time: p.time, dps: damage / p.time, fixed: true }, ...cands];
    }
    if (!cands.length || seconds <= 0.2) return;
    const best = cands[0];
    let reps = Math.floor(seconds / best.time + 1e-6);
    let remaining = seconds - reps * best.time;
    if (reps === 0) {
      const fit = cands.find((c) => c.time <= seconds);
      if (!fit) return;
      reps = 1;
      remaining = seconds - fit.time;
      addPattern(fit, 1);
    } else {
      addPattern(best, reps);
    }
    // 端数時間は入る中で効率の良いパターンで埋める
    const tail = best.fixed ? null : cands.find((c) => c.time <= remaining && c !== best);
    if (tail) addPattern(tail, 1);
    steps.push(`${title}: [${patternLabel(best.rows)}] ×${reps}${tail ? ` + [${patternLabel(tail.rows)}]` : ''}`);
    alternatives.push({ title, candidates: cands.slice(0, 4).map((c) => ({ label: patternLabel(c.rows), dps: c.dps, time: c.time })) });

    function addPattern(c, n) {
      if (c.fixed) {
        // 固定パターンは合計時間を段に按分
        const per = c.time / c.rows.length;
        for (const r of c.rows) add(r, n, Math.round(per * 100) / 100);
      } else {
        for (const r of c.rows) add(r, n);
      }
    }
  };

  if (stateTalent) {
    const D = profile.stateDuration ?? durationOf(engine, stateTalent) ?? 7;
    const chainRows = actions.filter((a) => a.talent === stateTalent && a.kind === 'chain');
    const chargedRows = actions.filter((a) => a.talent === stateTalent && a.kind === 'charged');
    if (chainRows.length) {
      fill(D, chainRows, chargedRows, `${CATEGORY_JA[stateTalent]}中の攻撃`);
      notes.push(`${CATEGORY_JA[stateTalent]}の特殊状態（約${D}秒）中は専用の攻撃に置き換わるため、その間の最適パターンを選びました。`);
    }
  }

  // --- 4. 残り時間を通常攻撃で埋める ---
  const fillNormal = profile.fillNormal ?? true;
  if (fillNormal) {
    const rest = profile.fillDuration ?? Math.max(0, L - used);
    const chainRows = actions.filter((a) => a.talent === 'normal' && a.kind === 'chain');
    const chargedRows = actions.filter((a) => a.talent === 'normal' && a.kind === 'charged');
    fill(rest, chainRows, chargedRows, '通常攻撃');
    const alt = alternatives.find((a) => a.title === '通常攻撃');
    if (alt?.candidates.length) {
      notes.push(`通常攻撃は「${alt.candidates[0].label}」が最もDPS効率が高い（${Math.round(alt.candidates[0].dps).toLocaleString()}/秒）と判定しました。モーション時間は武器種ごとの目安値です。`);
    }
  }

  const duration = profile.rotationLength ?? (Number(opts.rotationLength) || null);
  return {
    combo: { entries, duration },
    rotationLength: L,
    sequence: steps.join(' → '),
    notes,
    alternatives,
  };
}

export { ACTION_TIMING };
