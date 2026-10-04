// 天賦ラベル（例: "1-Hit DMG|{param1:F1P}"）を解析し、ダメージ計算に使える構造へ変換する。
// ビルド時（scripts/build-data.mjs）とテストの両方から利用する。

const STAT_WORDS = [
  [/^max hp$/i, 'hp'],
  [/^hp$/i, 'hp'],
  [/^atk$/i, 'atk'],
  [/^corresponding character's atk$/i, 'atk'],
  [/^def$/i, 'def'],
  [/^elemental mastery$/i, 'em'],
  [/^em$/i, 'em'],
];

const ELEMENT_WORDS = {
  physical: 'physical', pyro: 'pyro', hydro: 'hydro', electro: 'electro',
  cryo: 'cryo', anemo: 'anemo', geo: 'geo', dendro: 'dendro',
};

// ダメージ行ではない（バフ量・時間・間隔など）ものを除外するためのキーワード
const NON_DAMAGE_NAME = /(Bonus|Increase|Interval|Reduction|Absorption|Conversion|Decrease|Reduce|\bRES\b|Ratio|Limit|Threshold|Duration|Cap\b|Stamina|Healing|Regenerat|Restored|Cost|Gain|Consumption)/i;

// 月反応・星反応として扱われるダメージ（通常のダメージ式とは異なるため概算扱い）
export const REACTION_DAMAGE_NAME = /(Lunar-(Charged|Bloom|Crystallize)|Stellar[- ](Conduct|Swirl|Glimmer))/i;

// ダメージ行とみなす名前（"DMG" を含まない攻撃行もある）
const DAMAGE_NAME = /(DMG|^Charged Attack|Aimed Shot|^Fully-Charged|DoT$|^Riptide Slash$|^Blazing Threshold$|^Scorching Threshold$)/i;

/** "{param3:F1P}" 形式のトークン */
const PARAM_RE = /\{(param\d+):([A-Z0-9]+)\}/;

/** 括弧の外側だけで区切り文字分割する */
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseMultiplier(text) {
  // "×3", "*4", " ×5" などの回数表記
  const m = text.match(/[×*]\s*(\d+)\s*$/);
  if (!m) return { rest: text, count: 1 };
  return { rest: text.slice(0, m.index), count: Number(m[1]) };
}

/**
 * 1つの項（例: "{param1:F1P} Max HP ×3"）を解析
 * @returns {{param:string, percent:boolean, stat:string|null, element:string|null, count:number, unsupported:boolean}|null}
 */
function parseTerm(term) {
  const t = term.trim();
  const m = t.match(PARAM_RE);
  if (!m) return null;
  const format = m[2];
  const after = t.slice(m.index + m[0].length);
  const { rest, count } = parseMultiplier(after);
  const words = rest.trim();
  let stat = null;
  let element = null;
  let unsupported = false;
  if (words) {
    for (const [re, s] of STAT_WORDS) {
      if (re.test(words)) stat = s;
    }
    const el = ELEMENT_WORDS[words.toLowerCase()];
    if (el) element = el;
    if (!stat && !element && !/^each$/i.test(words)) unsupported = true;
  }
  return {
    param: m[1],
    percent: /P$/.test(format),
    stat,
    element,
    count,
    unsupported,
  };
}

/** 1つのバリエーション（"/" で区切られた1つ）を解析 */
function parseVariant(text) {
  let body = text.trim();
  let groupCount = 1;
  const g = body.match(/^\((.*)\)\s*[×*]\s*(\d+)$/);
  if (g) {
    body = g[1];
    groupCount = Number(g[2]);
  }
  const terms = splitTopLevel(body, '+').map(parseTerm);
  if (terms.some((x) => x === null)) return null;
  for (const term of terms) term.count *= groupCount;
  return terms;
}

/**
 * テンプレートをバリエーション×ヒットの配列に変換
 * "/" の後に {param} を含まない断片（"/s", "/Stack" など）は単位扱いとして前に結合する
 */
export function parseTemplate(tpl) {
  const segments = [];
  for (const seg of splitTopLevel(tpl, '/')) {
    if (PARAM_RE.test(seg) || segments.length === 0) segments.push(seg);
    else segments[segments.length - 1] += '/' + seg;
  }
  const hasUnit = segments.some((s) => /\/\s*[A-Za-z]/.test(s) || /\{param\d+:[A-Z0-9]+\}s\b/.test(s));
  const variants = segments.map(parseVariant);
  if (variants.some((v) => v === null)) return null;

  // スケールするステータスの補完: 未指定の項は右隣（同じバリエーション内）→他バリエーションの順で引き継ぐ
  const allStats = new Set(variants.flat().filter((h) => h.stat).map((h) => h.stat));
  const fallback = allStats.size === 1 ? [...allStats][0] : 'atk';
  for (const v of variants) {
    for (let i = v.length - 1; i >= 0; i--) {
      if (v[i].stat || !v[i].percent) continue;
      const right = v.slice(i + 1).find((h) => h.stat && h.percent);
      v[i].stat = right ? right.stat : fallback;
    }
  }
  return { variants, hasUnit };
}

function categoryOf(talentKey, nameEn) {
  if (talentKey === 'skill') return 'skill';
  if (talentKey === 'burst') return 'burst';
  if (/Plung/i.test(nameEn)) return 'plunge';
  if (/Charged|Aimed|Charge Level/i.test(nameEn)) return 'charged';
  // 通常攻撃天賦の "N-Hit DMG"・断流 以外（霜華の矢など）は重撃扱い
  if (/Hit\b|Riptide|Normal Attack/i.test(nameEn)) return 'normal';
  return 'charged';
}

/** 名前を "/" 区切りのバリエーション名へ分解（"Low/High Plunge DMG" → ["Low","High"]） */
export function variantSuffixes(name, n) {
  const parts = name.split('/');
  if (n <= 1) return [''];
  if (parts.length !== n) return Array.from({ length: n }, (_, i) => String(i + 1));
  const first = parts[0].trim();
  return parts.map((p, i) => {
    p = p.trim();
    if (i < n - 1) return p;
    if (/\s/.test(first) || /[a-z]/i.test(p)) {
      // 英語: 単語数を最初の部分に揃える
      const words = first.split(/\s+/).length;
      return p.split(/\s+/).slice(0, words).join(' ');
    }
    return p.length > first.length ? p.slice(0, first.length) : p;
  });
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

function numberOrNull(arr) {
  return Array.isArray(arr) && arr.length ? arr : null;
}

/**
 * 1つの天賦（通常攻撃/スキル/爆発）を解析
 * @param {'normal'|'skill'|'burst'} talentKey
 * @param {{name:string, attributes:{labels:string[], parameters:Object}}} en
 * @param {{name:string, attributes:{labels:string[]}}} ja
 */
export function parseTalent(talentKey, en, ja) {
  const labelsEn = en.attributes.labels;
  const labelsJa = ja?.attributes?.labels ?? labelsEn;
  const params = en.attributes.parameters;
  const rows = [];
  const extras = [];
  const info = { cooldown: null, energyCost: null, duration: null };
  let cdRank = 0;

  labelsEn.forEach((labelEn, idx) => {
    const [nameEn, tplEn = ''] = labelEn.split('|');
    const nameJa = (labelsJa[idx] ?? labelEn).split('|')[0];
    const parsed = parseTemplate(tplEn);

    // CD・元素エネルギー・継続時間は推奨コンボ生成で使う
    const firstParam = (tplEn.match(PARAM_RE) || [])[1];
    if (firstParam) {
      // 「CD」「Skill CD」を優先し、サブ技のCD（"Northland Spearstorm CD" など）とは区別する
      if (/(^|\s)CD$/i.test(nameEn)) {
        const rank = /^CD$/i.test(nameEn) ? 3 : /^(Skill|Press|Tap) CD$/i.test(nameEn) ? 2 : 1;
        if (!info.cooldown || rank > cdRank) {
          info.cooldown = numberOrNull(params[firstParam]);
          cdRank = rank;
        }
      }
      if (/Energy Cost/i.test(nameEn) && !info.energyCost) info.energyCost = params[firstParam]?.[0] ?? null;
      if (/^Duration$/i.test(nameEn) && !info.duration) info.duration = numberOrNull(params[firstParam]);
    }

    const hitsOk = !!parsed && !parsed.hasUnit
      && parsed.variants.every((v) => v.length && v.every((h) => h.percent && !h.unsupported));
    if (!hitsOk || !DAMAGE_NAME.test(nameEn) || NON_DAMAGE_NAME.test(nameEn)) {
      // ダメージ以外の数値（攻撃力アップ量など）はキャラ別プロファイルで参照できるよう保存
      const names = [...tplEn.matchAll(new RegExp(PARAM_RE.source, 'g'))].map((m) => m[1]);
      const all = names.filter((n) => params[n]).map((n) => params[n].map(round6));
      if (all.length) extras.push({ nameEn, nameJa, tpl: tplEn, values: all[0], params: all });
      return;
    }

    const category = categoryOf(talentKey, nameEn);
    const sufEn = variantSuffixes(nameEn, parsed.variants.length);
    const sufJa = variantSuffixes(nameJa, parsed.variants.length);
    parsed.variants.forEach((hits, vi) => {
      const single = parsed.variants.length === 1;
      const variantName = single ? nameEn : sufEn[vi];
      const special = REACTION_DAMAGE_NAME.exec(variantName.includes('Stellar') || variantName.includes('Lunar') ? variantName : nameEn);
      rows.push({
        id: `${talentKey}:${idx}:${vi}`,
        ...(special ? { special: /Lunar/i.test(special[0]) ? 'lunar' : 'stellar' } : {}),
        talent: talentKey,
        category,
        nameEn: single ? nameEn : `${nameEn} [${sufEn[vi]}]`,
        nameJa: single ? nameJa : `${nameJa}【${sufJa[vi]}】`,
        hits: hits.map((h) => ({
          stat: h.stat,
          count: h.count,
          ...(h.element ? { element: h.element } : {}),
          values: params[h.param].map(round6),
        })),
      });
    });
  });
  return { name: ja?.name ?? en.name, nameEn: en.name, rows, extras, ...info };
}
