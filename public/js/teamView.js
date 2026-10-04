// チームDPS画面（4人編成のローテーション）
import { h, clear, fmt, pct, sec, toast, img } from './dom.js';
import { store } from './store.js';
import { ROLE_JA, createTeam, evaluateTeam, normalizeTeam, recommendTeam } from './core/team.js';
import { REACTIONS, reactionApplies } from './core/damage.js';
import { CATEGORY_JA, ELEMENT_JA } from './core/constants.js';

const TALENT_JA = { normal: '通常攻撃', skill: '元素スキル', burst: '元素爆発' };
const frontIcon = (icon) => (icon ? icon.replace('_Side_', '_') : null);
const badge = (el) => h('span', { class: `badge el-${el}` }, ELEMENT_JA[el] ?? el);

let deps = null;
const view = { recommendation: null, addSelect: {} };

export function initTeamView(d) {
  deps = d;
}

function teamIdFromHash() {
  const m = location.hash.match(/^#\/team\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function supportedCharacters() {
  return store.listCharacters().filter((x) => x.build.supported && deps.db.characters[x.build.charKey]);
}

/** 保存済みチーム → 計算用の入力 */
function teamInputs(team) {
  return team.members.map((id) => {
    const build = id ? store.getCharacter(id) : null;
    const charData = build ? deps.db.characters[build.charKey] : null;
    if (!build || !charData) return null;
    return { id, charData, build, settings: store.getSettings(id) };
  });
}

/** ユーザーが明示的に選んだメインアタッカー（自動判定のときは null） */
const fixedMain = (team) => (team.mainAuto === false ? team.mainIndex : null);

function saveTeam(id, team) {
  store.saveTeam(id, team);
  renderTeamView();
}

function updateTeam(id, fn) {
  const t = normalizeTeam(store.getTeam(id));
  fn(t);
  saveTeam(id, t);
}

export function renderTeamView() {
  const root = clear(document.getElementById('view-team'));
  const chars = supportedCharacters();
  const teams = store.listTeams();
  const id = teamIdFromHash();
  const raw = id ? store.getTeam(id) : null;

  const createBtn = h('button', {
    class: 'btn btn-primary', disabled: chars.length === 0, onclick: () => {
      const members = chars.slice(0, 4).map((c) => c.id);
      while (members.length < 4) members.push(null);
      const newId = store.saveTeam(null, normalizeTeam({ name: `チーム ${teams.length + 1}`, members }));
      view.recommendation = null;
      location.hash = `#/team/${encodeURIComponent(newId)}`;
    },
  }, '＋ 新しいチーム');

  root.append(h('div', { class: 'section-head' },
    h('h1', {}, 'チームDPS（4人ローテーション）'),
    h('div', { class: 'row-actions' },
      teams.length > 0 && h('select', {
        class: 'char-picker', 'aria-label': 'チームを選択',
        onchange: (e) => { view.recommendation = null; location.hash = e.target.value ? `#/team/${encodeURIComponent(e.target.value)}` : '#/team'; },
      },
      h('option', { value: '' }, 'チームを選択'),
      teams.map((t) => h('option', { value: t.id, selected: t.id === id }, t.team.name || '(名前なし)'))),
      createBtn)));

  if (chars.length === 0) {
    root.append(h('div', { class: 'empty card' },
      h('p', {}, 'チームを組むには、まずキャラクターを登録してください。'),
      h('button', { class: 'btn btn-primary', onclick: () => (location.hash = '#/import') }, 'UIDから読み込む')));
    return;
  }
  if (!raw) {
    root.append(h('div', { class: 'card' },
      h('p', {}, '登録したキャラクターから4人を選んでチームを組むと、チームメイトのバフ（ベネットの攻撃力アップ、フリーナの与ダメージアップ、耐性ダウンなど）を',
        '実際の育成状況から自動計算し、ローテーション全体のDPSを計算します。'),
      teams.length
        ? h('ul', { class: 'saved-list' }, teams.map((t) => h('li', {},
          h('a', { href: `#/team/${encodeURIComponent(t.id)}` }, t.team.name || '(名前なし)'),
          h('span', { class: 'muted small' }, t.team.members.map((m) => store.getCharacter(m)?.nameJa ?? '-').join(' / ')))))
        : h('p', { class: 'muted' }, '「＋ 新しいチーム」から作成してください。')));
    return;
  }

  const team = normalizeTeam(raw);
  const calc = createTeam(teamInputs(team), team);
  // コンボが未設定のメンバーがいれば推奨ローテで初期化
  if (calc.members.some((m) => !team.combos[m.index])) {
    const rec = recommendTeam(calc, { mainIndex: fixedMain(team) });
    team.combos = team.combos.map((c, i) => c ?? rec.combos[i]);
    team.mainIndex ??= rec.mainIndex;
    store.saveTeam(id, team);
  }
  const result = evaluateTeam(calc, team.combos);

  root.append(h('div', { class: 'team-layout' },
    h('div', { class: 'calc-left' }, membersPanel(id, team, calc), settingsPanel(id, team), linksPanel(id, team, calc)),
    h('div', { class: 'calc-right' }, resultPanel(team, result), recommendPanel(id, team, calc),
      calc.members.map((m) => memberComboPanel(id, team, m, result.rows.find((r) => r.index === m.index)))),
  ));
}

// --- メンバー ---
function membersPanel(id, team, calc) {
  const chars = supportedCharacters();
  return h('section', { class: 'card' },
    h('h3', {}, 'メンバー'),
    team.mainAuto === false && h('p', { class: 'small' }, 'メインアタッカーを手動で指定中です。',
      h('button', { class: 'btn btn-small', onclick: () => updateTeam(id, (t) => { t.mainAuto = true; view.recommendation = null; }) }, '自動判定に戻す')),
    h('div', { class: 'team-slots' }, [0, 1, 2, 3].map((i) => {
      const memberId = team.members[i];
      const m = calc.members.find((x) => x.index === i);
      const build = m?.build;
      return h('div', { class: `team-slot ${build ? `el-border-${build.element}` : ''}` },
        h('div', { class: 'slot-head' },
          build ? img(frontIcon(build.icon), 'char-icon', build.nameJa) : h('span', { class: 'char-icon img-placeholder' }),
          h('div', { class: 'slot-body' },
            h('select', {
              'aria-label': `メンバー${i + 1}`,
              onchange: (e) => updateTeam(id, (t) => {
                t.members[i] = e.target.value || null;
                t.combos[i] = null;
                if (t.mainIndex === i) t.mainIndex = null;
                view.recommendation = null;
              }),
            },
            h('option', { value: '' }, '（空き）'),
            chars.map((c) => h('option', { value: c.id, selected: c.id === memberId }, `${c.build.nameJa}（Lv.${c.build.level}・${c.build.constellation}凸）`))),
            memberId && !build && h('div', { class: 'warn' }, 'このキャラは登録から削除されています'),
            build && h('div', { class: 'muted small' }, badge(build.element), ` ${build.weapon?.nameJa ?? ''}`))),
        build && h('div', { class: 'slot-options' },
          h('label', { class: 'inline' },
            h('input', { type: 'radio', name: 'main-member', checked: team.mainIndex === i, onchange: () => updateTeam(id, (t) => { t.mainIndex = i; t.mainAuto = false; }) }),
            'メインアタッカー', team.mainIndex === i && team.mainAuto !== false ? h('small', { class: 'muted' }, '（自動判定）') : null),
          h('label', { class: 'inline' }, '反応',
            h('select', {
              onchange: (e) => updateTeam(id, (t) => { t.reactions[i] = { ...(t.reactions[i] ?? {}), type: e.target.value }; }),
            }, Object.entries(REACTIONS)
              .filter(([k]) => k === 'none' || reactionApplies(k, build.element))
              .map(([k, r]) => h('option', { value: k, selected: (team.reactions[i]?.type ?? m.settings.reaction.type) === k }, r.label)))),
          (team.reactions[i]?.type ?? m.settings.reaction.type) !== 'none' && h('label', { class: 'inline' }, '発生率',
            h('input', {
              type: 'number', class: 'rate', min: 0, max: 100, step: 5, value: team.reactions[i]?.rate ?? m.settings.reaction.rate,
              onchange: (e) => updateTeam(id, (t) => { t.reactions[i] = { ...(t.reactions[i] ?? {}), rate: Math.min(100, Math.max(0, Number(e.target.value))) }; }),
            }), '%')));
    })));
}

// --- 設定 ---
function settingsPanel(id, team) {
  return h('section', { class: 'card' },
    h('h3', {}, 'チーム設定'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'チーム名', h('input', { type: 'text', value: team.name, maxlength: 40, onchange: (e) => updateTeam(id, (t) => { t.name = e.target.value.trim(); }) })),
      h('label', {}, 'ローテーション時間（秒）', h('input', {
        type: 'number', min: 5, max: 60, step: 1, value: team.rotationLength,
        onchange: (e) => updateTeam(id, (t) => { t.rotationLength = Math.max(5, Number(e.target.value) || 20); }),
      })),
      h('label', {}, '敵のレベル', h('input', { type: 'number', min: 1, max: 200, value: team.enemy.level, onchange: (e) => updateTeam(id, (t) => { t.enemy.level = Number(e.target.value) || 100; }) })),
      h('label', {}, '敵の元素耐性(%)', h('input', { type: 'number', step: 5, value: team.enemy.res, onchange: (e) => updateTeam(id, (t) => { t.enemy.res = Number(e.target.value); }) }))),
    h('p', { class: 'muted small' }, '各キャラの個別設定（バフ・天賦レベル・元素付与など）は「DPS計算」画面の設定がそのまま使われます。'),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn btn-small btn-danger', onclick: () => {
          if (!confirm(`「${team.name || 'このチーム'}」を削除しますか？`)) return;
          store.removeTeam(id);
          location.hash = '#/team';
        },
      }, 'チームを削除')));
}

// --- チームバフ ---
function linksPanel(id, team, calc) {
  const nameOf = (i) => calc.members.find((m) => m.index === i)?.build.nameJa ?? '';
  const set = (l, patch) => updateTeam(id, (t) => {
    const cur = t.buffs[l.id] ?? {};
    t.buffs[l.id] = { ...cur, ...patch, params: { ...(cur.params ?? {}), ...(patch.params ?? {}) } };
  });
  return h('section', { class: 'card' },
    h('h3', {}, 'チームバフ（メンバーから自動計算）'),
    calc.links.length === 0
      ? h('p', { class: 'muted small' }, 'このメンバーで自動計算できるチームバフはありません。必要なら各キャラの「DPS計算」画面のカスタムバフで補ってください。')
      : calc.links.map((l) => h('div', { class: `buff ${l.on ? 'on' : ''}` },
        h('label', { class: 'buff-label' },
          h('input', { type: 'checkbox', checked: l.on, onchange: (e) => set(l, { on: e.target.checked }) }),
          h('span', {}, l.def.label, h('br'), h('small', { class: 'muted' }, `対象: ${l.receivers.map(nameOf).join('・') || 'なし'}`))),
        l.on && l.def.params?.length > 0 && h('div', { class: 'buff-params' }, l.def.params.map((prm) => h('label', {}, prm.label,
          h('input', {
            type: 'number', value: l.params[prm.key], min: prm.min, max: prm.max, step: prm.step ?? 1,
            onchange: (e) => set(l, { on: true, params: { [prm.key]: Number(e.target.value) } }),
          })))))),
    h('p', { class: 'muted small' }, 'キャラ固有のサポート効果（ベネット・万葉・フリーナ・申鶴・シロネンなど）、旧貴族・翠緑などの聖遺物、龍殺し、元素共鳴を自動で検出します。'));
}

// --- 結果 ---
function resultPanel(team, r) {
  const rows = [...r.rows].sort((a, b) => b.damage - a.damage);
  return h('section', { class: 'card result team-result' },
    h('div', { class: 'result-main' },
      h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'チームDPS'), h('div', { class: 'kpi-value' }, fmt(r.dps))),
      h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, '合計ダメージ'), h('div', { class: 'kpi-value small' }, fmt(r.totalDamage))),
      h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'ローテーション'), h('div', { class: 'kpi-value small' }, sec(r.rotationLength)))),
    r.totalDamage > 0 && h('div', { class: 'breakdown' },
      h('div', { class: 'bar' }, rows.map((x) => h('span', { class: `seg el-${x.member.charData.element}`, style: { width: `${x.share * 100}%` }, title: `${x.member.build.nameJa} ${pct(x.share)}` })))),
    h('table', { class: 'mini-table team-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'メンバー'), h('th', { class: 'num' }, 'ダメージ'), h('th', { class: 'num' }, '割合'), h('th', { class: 'num' }, 'DPS'), h('th', { class: 'num' }, 'フィールド時間'))),
      h('tbody', {}, rows.map((x) => h('tr', {},
        h('td', {}, badge(x.member.charData.element), ' ', x.member.build.nameJa, team.mainIndex === x.index ? h('small', { class: 'muted' }, '（メイン）') : null),
        h('td', { class: 'num' }, fmt(x.damage)),
        h('td', { class: 'num' }, pct(x.share)),
        h('td', { class: 'num' }, fmt(x.damage / r.rotationLength)),
        h('td', { class: 'num' }, sec(x.fieldTime)))))),
    h('p', { class: r.overTime ? 'warn' : 'muted small' },
      `フィールド時間の合計: ${sec(r.fieldTime)} / ${sec(r.rotationLength)}`,
      r.overTime ? ' — ローテーション時間を超えています。回数を減らすか、ローテーション時間を延ばしてください。' : ''));
}

// --- 推奨チームローテ ---
function recommendPanel(id, team, calc) {
  const rec = view.recommendation?.id === id ? view.recommendation.rec : null;
  const box = h('section', { class: 'card recommend' },
    h('h3', {}, '推奨チームローテ'),
    h('p', { class: 'muted small' }, 'サポートは元素スキル・元素爆発（＋持続ダメージ）だけを行い、残りのフィールド時間をメインアタッカーが使う、という方針で全員のコンボを自動生成します。'),
    h('div', { class: 'row-actions' },
      h('button', {
        class: 'btn btn-primary', onclick: () => {
          view.recommendation = { id, rec: recommendTeam(calc, { mainIndex: fixedMain(team) }) };
          renderTeamView();
        },
      }, '推奨チームローテを生成')));
  if (rec) {
    const preview = evaluateTeam(calc, rec.combos);
    box.append(
      h('ol', { class: 'rec-order' }, rec.order.map((o) => h('li', {},
        h('div', {}, h('strong', {}, o.name), h('span', { class: 'muted small' }, ` ${ROLE_JA[o.role]} ・ ${o.start.toFixed(1)}秒〜`)),
        o.role === 'main'
          ? h('ul', { class: 'rec-steps' }, o.steps.map((x) => h('li', {}, x)))
          : h('div', { class: 'small' }, o.steps.join(' → '))))),
      h('div', { class: 'rec-kpi' }, `予想チームDPS ${fmt(preview.dps)}`),
      h('ul', { class: 'rec-notes' }, rec.notes.map((n) => h('li', {}, n))),
      h('button', {
        class: 'btn btn-primary', onclick: () => {
          updateTeam(id, (t) => { t.combos = rec.combos; t.mainIndex = rec.mainIndex; t.mainAuto = t.mainAuto === false ? false : true; });
          view.recommendation = null;
          toast('推奨チームローテを適用しました。', 'success');
        },
      }, 'このローテを適用'));
  }
  return box;
}

// --- メンバーごとのコンボ ---
function memberComboPanel(id, team, m, row) {
  const combo = team.combos[m.index] ?? { entries: [] };
  const engine = m.engine;
  const edit = (fn) => updateTeam(id, (t) => {
    t.combos[m.index] = t.combos[m.index] ?? { entries: [], duration: null };
    fn(t.combos[m.index]);
  });
  const select = h('select', { class: 'action-select', 'aria-label': 'アクションを選択' },
    ['normal', 'skill', 'burst'].map((t) => h('optgroup', { label: TALENT_JA[t] },
      engine.actions.filter((a) => a.talent === t).map((a) => h('option', { value: a.id }, a.nameJa)))),
    h('optgroup', { label: 'その他' }, engine.actions.filter((a) => !a.talent).map((a) => h('option', { value: a.id }, a.nameJa))));
  return h('details', { class: 'card member-combo', open: true },
    h('summary', {},
      badge(m.charData.element), ' ', h('strong', {}, m.build.nameJa),
      h('span', { class: 'muted small' }, ` 合計 ${fmt(row?.damage ?? 0)} ・ ${sec(row?.fieldTime ?? 0)}`)),
    combo.entries.length === 0
      ? h('p', { class: 'muted small' }, 'アクションがありません。')
      : h('div', { class: 'table-wrap' }, h('table', { class: 'combo-table' },
        h('tbody', {}, (row?.result.lines ?? []).map((line, i) => line.missing
          ? h('tr', { class: 'missing' }, h('td', { colspan: 5 }, '不明なアクション'),
            h('td', {}, h('button', { class: 'icon-btn', onclick: () => edit((c) => c.entries.splice(i, 1)) }, '×')))
          : h('tr', {},
            h('td', {}, h('div', { class: 'action-name' }, line.action.nameJa),
              h('div', { class: 'muted small' }, line.action.talent ? TALENT_JA[line.action.talent] : '', line.action.special ? '・反応ダメージ（概算）' : '')),
            h('td', {}, line.action.hits.length
              ? h('select', { onchange: (e) => edit((c) => { c.entries[i].reaction = e.target.value; }) }, reactionOptions(line.action, line.entry.reaction))
              : ''),
            h('td', {}, h('input', { type: 'number', class: 'count', min: 0, step: 1, value: line.count, onchange: (e) => edit((c) => { c.entries[i].count = Math.max(0, Number(e.target.value)); }) })),
            h('td', {}, h('input', { type: 'number', class: 'time', min: 0, step: 0.05, value: Math.round(line.perTime * 100) / 100, onchange: (e) => edit((c) => { c.entries[i].time = Math.max(0, Number(e.target.value)); }) })),
            h('td', { class: 'num strong' }, line.per.hits.length ? fmt(line.total) : '-'),
            h('td', { class: 'ops' }, h('button', { class: 'icon-btn', title: '削除', onclick: () => edit((c) => c.entries.splice(i, 1)) }, '×'))))))),
    h('div', { class: 'inline-form' },
      select,
      h('button', { class: 'btn btn-small', onclick: () => edit((c) => c.entries.push({ actionId: select.value, count: 1, reaction: 'auto' })) }, '追加'),
      h('a', { class: 'small', href: `#/calc/${encodeURIComponent(m.id)}` }, '個別設定（バフ・天賦など）')));
}

function reactionOptions(action, current) {
  const els = new Set(action.hits.map((x) => x.element));
  const opts = [['auto', '全体設定'], ['none', 'なし']];
  for (const [k, r] of Object.entries(REACTIONS)) {
    if (k !== 'none' && [...els].some((e) => reactionApplies(k, e))) opts.push([k, r.label]);
  }
  return opts.map(([v, l]) => h('option', { value: v, selected: (current ?? 'auto') === v }, l));
}

export { CATEGORY_JA };
