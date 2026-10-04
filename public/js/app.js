import { h, $, clear, fmt, pct, sec, toast, img } from './dom.js';
import { store, buildId } from './store.js';
import { isValidUid, parseEnkaResponse } from './core/enka.js';
import { ENKA_API, fetchEnkaData, githubConfig, issueUrl, waitForGitHub } from './enkaClient.js';
import { createEngine, normalizeSettings } from './core/engine.js';
import { evaluateCombo, recommendCombo } from './core/rotation.js';
import { REACTIONS, reactionApplies } from './core/damage.js';
import { CATEGORY_JA, ELEMENT_JA, PERCENT_STATS, SLOT_JA, STAT_JA, WEAPON_JA } from './core/constants.js';

const db = { characters: null, loc: null, meta: null };
const ui = {
  importResult: null,
  selected: new Set(),
  loading: false,
  recommendation: null,
  recLength: '',
  actionFilter: 'all',
};

const TALENT_JA = { normal: '通常攻撃', skill: '元素スキル', burst: '元素爆発' };

// ---------------------------------------------------------------------------
// 起動・ルーティング
// ---------------------------------------------------------------------------
async function init() {
  try {
    const [characters, loc, meta] = await Promise.all(
      ['characters', 'loc', 'meta'].map((n) => fetch(`data/${n}.json`).then((r) => {
        if (!r.ok) throw new Error(`data/${n}.json: HTTP ${r.status}`);
        return r.json();
      })),
    );
    Object.assign(db, { characters, loc, meta });
  } catch (err) {
    document.getElementById('app').prepend(h('div', { class: 'alert alert-error' },
      `データの読み込みに失敗しました: ${err.message}`));
    return;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      if (view === 'calc') {
        const last = store.listCharacters()[0];
        location.hash = last ? `#/calc/${encodeURIComponent(currentCalcId() ?? last.id)}` : '#/calc';
      } else {
        location.hash = `#/${view}`;
      }
    });
  }
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = store.listCharacters().length ? '#/roster' : '#/import';
  route();
}

function currentCalcId() {
  const m = location.hash.match(/^#\/calc\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : ui.lastCalcId ?? null;
}

function route() {
  const [, view = 'import', arg] = location.hash.match(/^#\/([^/]+)(?:\/(.+))?$/) ?? [];
  for (const v of ['import', 'roster', 'calc']) {
    document.getElementById(`view-${v}`).hidden = v !== view;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === view);
    tab.setAttribute('aria-selected', tab.dataset.view === view);
  }
  if (view === 'import') renderImport();
  else if (view === 'roster') renderRoster();
  else if (view === 'calc') {
    if (arg) ui.lastCalcId = decodeURIComponent(arg);
    ui.recommendation = null;
    renderCalc();
  }
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// 共通パーツ
// ---------------------------------------------------------------------------
const frontIcon = (icon) => (icon ? icon.replace('_Side_', '_') : null);

function elementBadge(el) {
  return h('span', { class: `badge el-${el}` }, ELEMENT_JA[el] ?? el);
}

function setSummary(sets) {
  const entries = Object.entries(sets ?? {}).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'セット効果なし';
  return entries.map(([en, n]) => `${setNameJa(en)} ${n >= 4 ? 4 : 2}`).join(' + ');
}

function setNameJa(en) {
  const hit = Object.values(db.meta?.sets ?? {}).find((s) => s.en === en);
  return hit?.ja ?? en;
}

function charCard(build, { selectable = false, actions = null } = {}) {
  const id = buildId(build);
  const p = build.panel;
  const el = build.element ?? 'physical';
  const checked = ui.selected.has(id);
  return h('article', { class: `char-card el-border-${el} ${build.supported ? '' : 'unsupported'}` },
    h('div', { class: 'char-head' },
      selectable && h('input', {
        type: 'checkbox', class: 'char-check', checked, disabled: !build.supported, 'aria-label': `${build.nameJa}を選択`,
        onchange: (e) => {
          if (e.target.checked) ui.selected.add(id);
          else ui.selected.delete(id);
          renderImport();
        },
      }),
      img(frontIcon(build.icon), 'char-icon', build.nameJa),
      h('div', { class: 'char-title' },
        h('div', { class: 'char-name' }, build.nameJa, ' ', build.element && elementBadge(build.element)),
        h('div', { class: 'muted' }, `Lv.${build.level} ・ ${build.constellation}凸`, build.uid ? ` ・ UID ${build.uid}` : ''),
      ),
    ),
    !build.supported && h('p', { class: 'warn' }, 'このキャラクターは天賦データ未対応のため計算できません。'),
    build.weapon && h('div', { class: 'char-line' },
      img(build.weapon.icon, 'mini-icon'),
      `${build.weapon.nameJa} R${build.weapon.refinement} Lv.${build.weapon.level}`),
    h('div', { class: 'char-line' }, '天賦: ',
      ['normal', 'skill', 'burst'].map((t) => {
        const lv = build.talentLevels?.[t];
        const boosted = lv && build.talentBase?.[t] && lv > build.talentBase[t];
        return h('span', { class: `talent-chip ${boosted ? 'boosted' : ''}` }, `${TALENT_JA[t].slice(-2)} ${lv ?? '-'}`);
      })),
    h('div', { class: 'char-line muted' }, setSummary(build.sets)),
    h('div', { class: 'stat-mini' },
      h('span', {}, `HP ${fmt(p.hp)}`), h('span', {}, `攻撃 ${fmt(p.atk)}`),
      h('span', {}, `会心 ${pct(p.cr)} / ${pct(p.cd)}`), h('span', {}, `熟知 ${fmt(p.em)}`),
      h('span', {}, `チャージ ${pct(p.er)}`)),
    actions && h('div', { class: 'card-actions' }, actions),
  );
}

// ---------------------------------------------------------------------------
// 読み込み画面
// ---------------------------------------------------------------------------
// サイト設定（config.js）。GitHub Pages では保存先リポジトリをURLから自動判定する
const siteConfig = window.GENSHIN_DPS_CONFIG ?? {};
const gh = githubConfig(siteConfig);

async function fetchUid(uid) {
  return fetchEnkaData(uid, { sameOrigin: siteConfig.sameOriginApi !== false, github: gh });
}

function timeAgo(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  if (min < 60 * 24) return `${Math.round(min / 60)}時間前`;
  return `${Math.round(min / 60 / 24)}日前`;
}

async function loadUid(uid) {
  uid = String(uid).trim();
  if (!isValidUid(uid)) {
    toast('UIDは9〜10桁の数字で入力してください。', 'error');
    return;
  }
  stopWaiting();
  ui.loading = true;
  ui.importError = null;
  ui.request = null;
  store.lastUid = uid;
  renderImport();
  try {
    const r = await fetchUid(uid);
    applyImport(r.json, uid, r);
  } catch (err) {
    ui.importResult = null;
    if (err.code === 'not-cached' || err.code === 'unavailable') {
      ui.request = { uid, lastError: err.lastError ?? null, reason: err.code };
    } else {
      ui.importError = err.message;
    }
  } finally {
    ui.loading = false;
    renderImport();
  }
}

function applyImport(json, uid = null, source = null) {
  const result = parseEnkaResponse({ uid, ...json }, db);
  ui.importResult = result;
  ui.importSource = source ? { via: source.via, fetchedAt: source.fetchedAt ?? null } : { via: 'paste' };
  ui.importError = null;
  ui.selected = new Set(result.characters.filter((c) => c.supported).map(buildId));
  if (!result.characters.length) {
    ui.importResult.warning = 'キャラクター詳細が公開されていません。ゲーム内のプロフィールで「キャラクターラインナップ」にキャラを設定し、「キャラ詳細を表示」をONにしてから、もう一度取得してください。';
  }
}

// --- GitHub Actions への取得依頼 ---
function stopWaiting() {
  ui.waiting?.controller.abort();
  ui.waiting = null;
}

async function requestViaGitHub(uid) {
  stopWaiting();
  window.open(issueUrl(uid, gh), '_blank', 'noopener');
  const controller = new AbortController();
  ui.waiting = { uid, since: new Date().toISOString(), controller };
  renderImport();
  try {
    const r = await waitForGitHub(uid, gh, ui.waiting.since, {
      signal: controller.signal,
      onTick: (n, elapsed) => {
        const el = document.getElementById('wait-elapsed');
        if (el) el.textContent = `${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`;
      },
    });
    ui.waiting = null;
    ui.request = null;
    applyImport(r.json, uid, r);
    toast('GitHub Actions からデータを受け取りました。', 'success');
  } catch (err) {
    if (err.code === 'cancelled') return;
    ui.waiting = null;
    ui.importError = err.message;
  }
  renderImport();
}

function pasteImport(text, uid) {
  try {
    applyImport(JSON.parse(text), uid);
    ui.request = null;
    stopWaiting();
    renderImport();
  } catch (err) {
    toast(`JSONを読み込めませんでした: ${err.message}`, 'error');
  }
}

/** データ取得の依頼パネル（GitHub Issue 経由 / Enka から手動コピー） */
function requestPanel(uid, { refresh = false, lastError = null } = {}) {
  const enkaUrl = `${ENKA_API}/${uid}`;
  const paste = h('textarea', { rows: 4, placeholder: '{"playerInfo": ..., "avatarInfoList": [...]}', 'aria-label': 'EnkaのJSON' });
  const waiting = ui.waiting?.uid === uid;
  return h('div', { class: 'card request-panel' },
    h('h2', {}, refresh ? `UID ${uid} のデータを最新にする` : `UID ${uid} のデータを取得する`),
    !refresh && h('p', { class: 'muted' }, 'このUIDのデータはまだサイトに保存されていません。次のどちらかの方法で取得してください。'),
    lastError && h('div', { class: 'alert alert-error small' }, `前回の取得エラー: ${lastError.message}`),
    h('div', { class: 'request-options' },
      gh && h('section', { class: 'request-option' },
        h('h3', {}, 'A. GitHubで取得を依頼する ', h('span', { class: 'badge-soft' }, 'おすすめ')),
        h('ol', { class: 'steps' },
          h('li', {}, '下のボタンを押すと、GitHub の Issue 作成画面が開きます（GitHubアカウントが必要・無料）。'),
          h('li', {}, 'そのまま「Create」（Submit new issue）を押します。'),
          h('li', {}, 'GitHub Actions が Enka.Network からデータを取得し、1分ほどでこの画面に自動で読み込まれます。')),
        waiting
          ? h('div', { class: 'waiting' },
            h('span', { class: 'spinner', 'aria-hidden': 'true' }),
            h('span', {}, 'GitHub Actions の処理を待っています… ', h('span', { id: 'wait-elapsed' }, '0:00')),
            h('button', { class: 'btn btn-small', onclick: () => { stopWaiting(); renderImport(); } }, 'キャンセル'),
            h('a', { class: 'small', href: issueUrl(uid, gh), target: '_blank', rel: 'noopener' }, 'Issue画面をもう一度開く'))
          : h('button', { class: 'btn btn-primary', onclick: () => requestViaGitHub(uid) }, 'GitHubで取得を依頼する')),
      h('section', { class: 'request-option' },
        h('h3', {}, `${gh ? 'B' : 'A'}. Enka からコピーして貼り付ける `, h('span', { class: 'badge-soft' }, 'アカウント不要')),
        h('ol', { class: 'steps' },
          h('li', {}, h('a', { href: enkaUrl, target: '_blank', rel: 'noopener' }, 'Enka のデータを開く'), '（別タブで文字がたくさん表示されます）'),
          h('li', {}, '表示された文字をすべてコピーします（PC: Ctrl+A → Ctrl+C ／ スマホ: 長押し → すべて選択 → コピー）。'),
          h('li', {}, '下の欄に貼り付けて「読み込む」を押します。')),
        paste,
        h('button', { class: 'btn', onclick: () => pasteImport(paste.value, uid) }, '読み込む'))),
  );
}

function registerSelected(goCalc = false) {
  const chars = (ui.importResult?.characters ?? []).filter((c) => ui.selected.has(buildId(c)));
  if (!chars.length) {
    toast('登録するキャラクターを選択してください。', 'error');
    return;
  }
  let lastId = null;
  for (const c of chars) lastId = store.saveCharacter(c);
  toast(`${chars.length}体のキャラクターを登録しました。`, 'success');
  location.hash = goCalc && chars.length === 1 ? `#/calc/${encodeURIComponent(lastId)}` : '#/roster';
}

function renderImport() {
  const root = clear(document.getElementById('view-import'));
  const input = h('input', {
    id: 'uid-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 10,
    placeholder: '例: 800000001', value: store.lastUid ?? '',
    onkeydown: (e) => { if (e.key === 'Enter') loadUid(input.value); },
  });
  root.append(
    h('div', { class: 'card hero' },
      h('h1', {}, 'UIDからキャラクターを読み込む'),
      h('p', { class: 'muted' }, 'プロフィールの「キャラクターラインナップ」に表示しているキャラの、レベル・天賦・武器・聖遺物を自動で取得します。'),
      h('div', { class: 'uid-form' },
        h('label', { for: 'uid-input', class: 'sr-only' }, 'UID'),
        input,
        h('button', { class: 'btn btn-primary', disabled: ui.loading, onclick: () => loadUid(input.value) },
          ui.loading ? '読み込み中…' : '読み込む')),
      h('details', { class: 'help' },
        h('summary', {}, 'キャラが表示されない場合'),
        h('ol', {},
          h('li', {}, 'ゲーム内「パイモンメニュー → プロフィール → 編集」でキャラクターラインナップに表示したいキャラを設定します（最大12体）。'),
          h('li', {}, '「キャラ詳細を表示」をONにします。'),
          h('li', {}, '反映まで数分かかることがあります。Enka.Network のキャッシュ（数分）が切れてから再度読み込んでください。'))),
      h('details', { class: 'help' },
        h('summary', {}, 'JSONファイル・テキストを直接読み込む'),
        h('p', { class: 'muted small' }, 'Enka.Network の API（https://enka.network/api/uid/〈UID〉）のJSONを貼り付けてください。'),
        h('textarea', { id: 'json-input', rows: 4, placeholder: '{"playerInfo": ..., "avatarInfoList": [...]}' }),
        h('button', { class: 'btn', onclick: () => pasteImport($('#json-input').value, null) }, 'JSONを読み込む')),
    ),
  );

  if (ui.importError) root.append(h('div', { class: 'alert alert-error' }, ui.importError));
  if (ui.request) {
    root.append(requestPanel(ui.request.uid, { refresh: ui.request.refresh, lastError: ui.request.lastError }));
  }

  const r = ui.importResult;
  if (!r) return;
  const src = ui.importSource;
  if (src?.via === 'github' && !ui.request) {
    root.append(h('div', { class: 'alert source-info' },
      h('span', {}, `GitHub に保存されたデータを表示しています（最終取得: ${src.fetchedAt ? `${new Date(src.fetchedAt).toLocaleString('ja-JP')}・${timeAgo(src.fetchedAt)}` : '不明'}）。`),
      r.uid && h('button', {
        class: 'btn btn-small', onclick: () => { ui.request = { uid: r.uid, refresh: true }; renderImport(); },
      }, '最新データを取得する')));
  }
  root.append(h('div', { class: 'card player-card' },
    h('div', {},
      h('div', { class: 'player-name' }, r.player.nickname || '(名前なし)'),
      h('div', { class: 'muted' }, `UID ${r.uid ?? '-'} ・ 冒険ランク ${r.player.level ?? '-'} ・ 世界ランク ${r.player.worldLevel ?? '-'}`),
      r.player.signature && h('div', { class: 'muted small' }, r.player.signature)),
    h('div', { class: 'player-actions' },
      h('button', { class: 'btn', onclick: () => { ui.selected = new Set(r.characters.filter((c) => c.supported).map(buildId)); renderImport(); } }, 'すべて選択'),
      h('button', { class: 'btn', onclick: () => { ui.selected.clear(); renderImport(); } }, '選択解除'),
      h('button', { class: 'btn btn-primary', onclick: () => registerSelected(false) }, `選択したキャラを登録（${ui.selected.size}）`)),
  ));
  if (r.warning) root.append(h('div', { class: 'alert' }, r.warning));
  root.append(h('div', { class: 'char-grid' },
    r.characters.map((c) => charCard(c, {
      selectable: true,
      actions: c.supported && [
        h('button', {
          class: 'btn btn-small', onclick: () => {
            ui.selected = new Set([buildId(c)]);
            registerSelected(true);
          },
        }, 'このキャラを登録して計算'),
      ],
    }))));
}

// ---------------------------------------------------------------------------
// 登録キャラ画面
// ---------------------------------------------------------------------------
/** 登録済みキャラの再取得: 読み込み画面で同じUIDを読み込み直す（登録すると上書き更新される） */
function refreshCharacter(id) {
  const build = store.getCharacter(id);
  if (!build?.uid) return;
  location.hash = '#/import';
  setTimeout(() => loadUid(build.uid), 0);
}

function renderRoster() {
  const root = clear(document.getElementById('view-roster'));
  const list = store.listCharacters();
  root.append(h('div', { class: 'section-head' },
    h('h1', {}, '登録キャラ'),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => (location.hash = '#/import') }, '＋ UIDから追加'),
      h('button', {
        class: 'btn', onclick: () => {
          const blob = new Blob([store.exportAll()], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: 'genshin-dps-backup.json' });
          a.click();
          URL.revokeObjectURL(a.href);
        },
      }, 'バックアップを保存'),
      h('label', { class: 'btn' }, 'バックアップを復元',
        h('input', {
          type: 'file', accept: 'application/json', class: 'sr-only', onchange: async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              store.importAll(await file.text());
              toast('バックアップを復元しました。', 'success');
              renderRoster();
            } catch (err) {
              toast(`復元に失敗しました: ${err.message}`, 'error');
            }
          },
        })))));
  if (!list.length) {
    root.append(h('div', { class: 'empty card' },
      h('p', {}, 'まだキャラクターが登録されていません。'),
      h('button', { class: 'btn btn-primary', onclick: () => (location.hash = '#/import') }, 'UIDから読み込む')));
    return;
  }
  // UIDごとにまとめて表示
  const byUid = new Map();
  for (const item of list) {
    const k = item.build.uid ?? '手動';
    if (!byUid.has(k)) byUid.set(k, []);
    byUid.get(k).push(item);
  }
  for (const [uid, items] of byUid) {
    root.append(h('h2', { class: 'group-title' }, `UID ${uid}`,
      uid !== '手動' && h('button', { class: 'btn btn-small', onclick: () => { location.hash = '#/import'; setTimeout(() => loadUid(uid), 0); } }, 'このUIDを再読み込み')));
    root.append(h('div', { class: 'char-grid' }, items.map(({ id, build }) => charCard(build, {
      actions: [
        build.supported && h('button', { class: 'btn btn-primary btn-small', onclick: () => (location.hash = `#/calc/${encodeURIComponent(id)}`) }, 'DPSを計算'),
        build.uid && h('button', { class: 'btn btn-small', onclick: () => refreshCharacter(id) }, '最新に更新'),
        h('button', {
          class: 'btn btn-small btn-danger', onclick: () => {
            if (!confirm(`${build.nameJa}を削除しますか？（保存したコンボも削除されます）`)) return;
            store.removeCharacter(id);
            renderRoster();
          },
        }, '削除'),
        h('span', { class: 'muted small' }, `取得: ${new Date(build.fetchedAt).toLocaleString('ja-JP')}`),
      ],
    }))));
  }
}

// ---------------------------------------------------------------------------
// DPS計算画面
// ---------------------------------------------------------------------------
function calcState(id) {
  const build = store.getCharacter(id);
  if (!build) return null;
  const charData = db.characters[build.charKey];
  if (!charData) return { build, charData: null };
  const settings = normalizeSettings(store.getSettings(id));
  const engine = createEngine(charData, build, settings);
  const combos = store.getCombos(id);
  if (!combos.current) {
    // 初回は推奨コンボを自動でセット
    combos.current = recommendCombo(engine).combo;
    store.saveCombos(id, combos);
  }
  return { id, build, charData, settings, engine, combos };
}

function updateSettings(id, fn) {
  const s = normalizeSettings(store.getSettings(id));
  fn(s);
  store.saveSettings(id, s);
  renderCalc();
}

function updateCombo(id, fn) {
  const c = store.getCombos(id);
  c.current = c.current ?? { entries: [], duration: null };
  fn(c.current, c);
  store.saveCombos(id, c);
  renderCalc();
}

function renderCalc() {
  const root = clear(document.getElementById('view-calc'));
  const id = currentCalcId();
  const list = store.listCharacters().filter((x) => x.build.supported);
  if (!list.length) {
    root.append(h('div', { class: 'empty card' },
      h('p', {}, '計算するキャラクターが登録されていません。'),
      h('button', { class: 'btn btn-primary', onclick: () => (location.hash = '#/import') }, 'UIDから読み込む')));
    return;
  }
  const st = id ? calcState(id) : null;
  const picker = h('select', {
    class: 'char-picker', 'aria-label': 'キャラクターを選択',
    onchange: (e) => (location.hash = `#/calc/${encodeURIComponent(e.target.value)}`),
  },
  !st && h('option', { value: '' }, 'キャラクターを選択'),
  list.map((x) => h('option', { value: x.id, selected: x.id === id }, `${x.build.nameJa}（UID ${x.build.uid ?? '-'}）`)));
  root.append(h('div', { class: 'section-head' }, h('h1', {}, 'DPS計算'), picker));
  if (!st) return;
  if (!st.charData) {
    root.append(h('div', { class: 'alert alert-error' }, 'このキャラクターの天賦データがありません。'));
    return;
  }
  const result = evaluateCombo(st.engine, st.combos.current);
  root.append(
    h('div', { class: 'calc-layout' },
      h('div', { class: 'calc-left' },
        buildPanel(st),
        settingsPanel(st),
        buffPanel(st)),
      h('div', { class: 'calc-right' },
        resultPanel(st, result),
        comboPanel(st, result),
        recommendPanel(st),
        actionPanel(st))),
  );
}

// --- ビルド概要 ---
function buildPanel(st) {
  const { build, engine, id } = st;
  const s = engine.stats;
  const p = build.panel;
  const el = build.element;
  const rows = [
    ['HP', p.hp, s.hp, fmt], ['攻撃力', p.atk, s.atk, fmt], ['防御力', p.def, s.def, fmt],
    ['元素熟知', p.em, s.em, fmt], ['会心率', p.cr, s.cr, pct], ['会心ダメージ', p.cd, s.cd, pct],
    ['元素チャージ効率', p.er, s.er, pct],
    [`${ELEMENT_JA[el]}元素ダメージ`, p.dmg[el], s.dmg[el], pct],
    ['物理ダメージ', p.dmg.physical, s.dmg.physical, pct],
  ];
  return h('section', { class: 'card' },
    h('div', { class: 'build-head' },
      img(frontIcon(build.icon), 'char-icon large', build.nameJa),
      h('div', {},
        h('h2', {}, build.nameJa, ' ', elementBadge(el)),
        h('div', { class: 'muted' }, `Lv.${build.level} ・ ${build.constellation}凸 ・ ${WEAPON_JA[build.weaponType] ?? ''}`),
        build.weapon && h('div', { class: 'muted' }, `${build.weapon.nameJa} R${build.weapon.refinement} Lv.${build.weapon.level}`))),
    h('div', { class: 'talent-row' },
      ['normal', 'skill', 'burst'].map((t) => {
        const cur = engine.ctx.talentLevels[t];
        const base = build.talentBase?.[t];
        const bonus = (build.talentLevels?.[t] ?? 0) - (base ?? 0);
        return h('label', { class: 'talent-select' },
          h('span', {}, TALENT_JA[t], bonus > 0 ? h('small', { class: 'muted' }, ` (+${bonus})`) : null),
          h('select', {
            onchange: (e) => updateSettings(id, (x) => { x.talentOverride[t] = Number(e.target.value); }),
          }, Array.from({ length: 15 }, (_, i) => h('option', { value: i + 1, selected: cur === i + 1 }, `Lv.${i + 1}`))));
      })),
    h('table', { class: 'stat-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'ステータス'), h('th', {}, 'パネル'), h('th', {}, 'バフ込み'))),
      h('tbody', {}, rows.map(([label, a, b, f]) => h('tr', {},
        h('td', {}, label), h('td', {}, f(a)),
        h('td', { class: Math.abs(b - a) > 1e-9 ? 'up' : '' }, f(b)))))),
    h('details', { class: 'artifacts' },
      h('summary', {}, `聖遺物（${setSummary(build.sets)}）`),
      build.artifacts.map((a) => h('div', { class: 'artifact' },
        img(a.icon, 'mini-icon'),
        h('div', {},
          h('div', {}, h('strong', {}, SLOT_JA[a.slot] ?? a.slot), ` +${a.level} ・ ${a.setNameJa}`),
          a.main && h('div', { class: 'art-main' }, statText(a.main)),
          h('div', { class: 'art-subs' }, a.subs.map((x) => h('span', {}, statText(x)))))))),
  );
}

function statText(s) {
  const label = STAT_JA[s.key] ?? db.loc?.ja?.[s.prop] ?? s.prop;
  const v = PERCENT_STATS.has(s.key) ? `${s.value.toFixed(1)}%` : Math.round(s.value).toLocaleString('ja-JP');
  return `${label} ${v}`;
}

// --- 敵・反応設定 ---
function settingsPanel(st) {
  const { id, settings } = st;
  const num = (value, onchange, attrs = {}) => h('input', { type: 'number', value, onchange, ...attrs });
  return h('section', { class: 'card' },
    h('h3', {}, '敵・元素反応'),
    h('div', { class: 'form-grid' },
      h('label', {}, '敵のレベル', num(settings.enemy.level, (e) => updateSettings(id, (x) => { x.enemy.level = Number(e.target.value) || 100; }), { min: 1, max: 200 })),
      h('label', {}, '敵の元素耐性(%)', num(settings.enemy.res, (e) => updateSettings(id, (x) => { x.enemy.res = Number(e.target.value); }), { step: 5 })),
      h('label', {}, '元素反応（全体）',
        h('select', { onchange: (e) => updateSettings(id, (x) => { x.reaction.type = e.target.value; }) },
          Object.entries(REACTIONS).map(([k, r]) => h('option', { value: k, selected: settings.reaction.type === k }, r.label)))),
      h('label', {}, '反応の発生率(%)', num(settings.reaction.rate, (e) => updateSettings(id, (x) => { x.reaction.rate = Math.min(100, Math.max(0, Number(e.target.value))); }), { min: 0, max: 100, step: 5 })),
      h('label', {}, '通常・重撃・落下の属性',
        h('select', { onchange: (e) => updateSettings(id, (x) => { x.infusion = e.target.value; }) },
          [['auto', '自動（法器・元素付与キャラは元素）'], ['on', '元素ダメージ'], ['off', '物理ダメージ']]
            .map(([v, l]) => h('option', { value: v, selected: settings.infusion === v }, l))))),
    h('p', { class: 'muted small' }, '反応はアクションごとに個別指定もできます。蒸発・溶解は炎/水/氷、超激化は雷、草激化は草のヒットにのみ適用されます。'),
  );
}

// --- バフ ---
const BUFF_GROUP_JA = {
  profile: 'キャラ固有の効果',
  set: '聖遺物セット効果（自動検出）',
  team: 'チームバフ',
  custom: 'カスタム（武器効果・命ノ星座など）',
};

function buffPanel(st) {
  const { id, engine } = st;
  const groups = {};
  for (const b of engine.buffs) (groups[b.group] ??= []).push(b);
  const setOn = (b, on) => updateSettings(id, (x) => {
    x.buffs[b.def.id] = { ...(x.buffs[b.def.id] ?? {}), on };
  });
  const setParam = (b, key, value) => updateSettings(id, (x) => {
    const cur = x.buffs[b.def.id] ?? {};
    x.buffs[b.def.id] = { ...cur, on: cur.on ?? b.on, params: { ...(cur.params ?? {}), [key]: value } };
  });
  return h('section', { class: 'card' },
    h('h3', {}, 'バフ・デバフ'),
    ['profile', 'set', 'team', 'custom'].map((g) => groups[g]?.length && h('div', { class: 'buff-group' },
      h('h4', {}, BUFF_GROUP_JA[g]),
      g === 'set' && !groups[g].length && h('p', { class: 'muted small' }, '計算に影響するセット効果はありません。'),
      groups[g].map((b) => h('div', { class: `buff ${b.on ? 'on' : ''}` },
        g !== 'custom' && h('label', { class: 'buff-label' },
          h('input', { type: 'checkbox', checked: b.on, onchange: (e) => setOn(b, e.target.checked) }),
          h('span', {}, b.def.label)),
        b.def.params?.length && (b.on || g === 'custom') && h('div', { class: g === 'custom' ? 'form-grid compact' : 'buff-params' },
          b.def.params.map((prm) => paramInput(prm, b.params[prm.key], (v) => setParam(b, prm.key, v)))))))),
    !groups.set?.length && h('p', { class: 'muted small' }, '聖遺物セット効果: 計算に影響する効果はありません。'),
  );
}

function paramInput(prm, value, onChange) {
  if (prm.type === 'select') {
    return h('label', {}, prm.label,
      h('select', { onchange: (e) => onChange(e.target.value) },
        prm.options.map(([v, l]) => h('option', { value: v, selected: value === v }, l))));
  }
  if (prm.type === 'toggle') {
    return h('label', { class: 'inline' },
      h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked) }), prm.label);
  }
  return h('label', { title: prm.hint ?? '' }, prm.label,
    h('input', {
      type: 'number', value, min: prm.min, max: prm.max, step: prm.step ?? 1,
      onchange: (e) => onChange(Number(e.target.value)),
    }));
}

// --- 結果 ---
function resultPanel(st, r) {
  const cats = Object.entries(r.byCategory).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return h('section', { class: 'card result' },
    h('div', { class: 'result-main' },
      h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'DPS'), h('div', { class: 'kpi-value' }, fmt(r.dps))),
      h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, '合計ダメージ'), h('div', { class: 'kpi-value small' }, fmt(r.totalDamage))),
      h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, r.duration !== r.totalTime ? 'ローテーション時間' : 'コンボ時間'), h('div', { class: 'kpi-value small' }, sec(r.duration)))),
    cats.length > 0 && h('div', { class: 'breakdown' },
      h('div', { class: 'bar' }, cats.map(([c, v]) => h('span', { class: `seg cat-${c}`, style: { width: `${(v / r.totalDamage) * 100}%` }, title: `${CATEGORY_JA[c]} ${pct(v / r.totalDamage)}` }))),
      h('div', { class: 'legend' }, cats.map(([c, v]) => h('span', {}, h('i', { class: `dot cat-${c}` }), `${CATEGORY_JA[c]} ${pct(v / r.totalDamage, 0)}`)))),
  );
}

// --- コンボ編集 ---
function reactionOptions(action, current) {
  const els = new Set(action.hits.map((x) => x.element));
  const opts = [['auto', '全体設定'], ['none', 'なし']];
  for (const [k, r] of Object.entries(REACTIONS)) {
    if (k !== 'none' && [...els].some((e) => reactionApplies(k, e))) opts.push([k, r.label]);
  }
  return opts.map(([v, l]) => h('option', { value: v, selected: (current ?? 'auto') === v }, l));
}

function comboPanel(st, r) {
  const { id, combos } = st;
  const combo = combos.current;
  const move = (i, d) => updateCombo(id, (c) => {
    const j = i + d;
    if (j < 0 || j >= c.entries.length) return;
    [c.entries[i], c.entries[j]] = [c.entries[j], c.entries[i]];
  });
  const nameInput = h('input', { type: 'text', placeholder: 'コンボ名（例: 単体ローテ）', maxlength: 40 });
  return h('section', { class: 'card' },
    h('div', { class: 'section-head small' },
      h('h3', {}, 'コンボ'),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn-small', onclick: () => updateCombo(id, (c) => { c.entries = []; c.duration = null; }) }, 'クリア'))),
    combo.entries.length === 0
      ? h('p', { class: 'muted' }, '下の「アクション」から通常攻撃・元素スキル・元素爆発を追加するか、「推奨コンボを生成」を押してください。')
      : h('div', { class: 'table-wrap' }, h('table', { class: 'combo-table' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'アクション'), h('th', {}, '反応'), h('th', {}, '回数'), h('th', {}, '時間/回'),
          h('th', { class: 'num' }, '1回の期待値'), h('th', { class: 'num' }, '合計'), h('th', {}, ''))),
        h('tbody', {}, r.lines.map((line, i) => line.missing
          ? h('tr', { class: 'missing' }, h('td', { colspan: 6 }, `不明なアクション（${line.entry.actionId}）`),
            h('td', {}, h('button', { class: 'icon-btn', title: '削除', onclick: () => updateCombo(id, (c) => c.entries.splice(i, 1)) }, '×')))
          : h('tr', {},
            h('td', {},
              h('div', { class: 'action-name' }, line.action.nameJa),
              h('div', { class: 'muted small' }, line.action.talent ? TALENT_JA[line.action.talent] : '',
                line.action.hits.length ? ' ・ ' : '', [...new Set(line.action.hits.map((x) => ELEMENT_JA[x.element]))].join('/'))),
            h('td', {}, line.action.hits.length
              ? h('select', { onchange: (e) => updateCombo(id, (c) => { c.entries[i].reaction = e.target.value; }) }, reactionOptions(line.action, line.entry.reaction))
              : ''),
            h('td', {}, h('input', {
              type: 'number', class: 'count', min: 0, step: 1, value: line.count,
              onchange: (e) => updateCombo(id, (c) => { c.entries[i].count = Math.max(0, Number(e.target.value)); }),
            })),
            h('td', {}, h('input', {
              type: 'number', class: 'time', min: 0, step: 0.05, value: Math.round(line.perTime * 100) / 100,
              onchange: (e) => updateCombo(id, (c) => { c.entries[i].time = Math.max(0, Number(e.target.value)); }),
            })),
            h('td', { class: 'num', title: line.per.hits.length ? `非会心 ${fmt(line.per.nonCrit)} / 会心 ${fmt(line.per.crit)}` : '' }, line.per.hits.length ? fmt(line.per.avg) : '-'),
            h('td', { class: 'num strong' }, line.per.hits.length ? fmt(line.total) : '-'),
            h('td', { class: 'ops' },
              h('button', { class: 'icon-btn', title: '上へ', onclick: () => move(i, -1) }, '↑'),
              h('button', { class: 'icon-btn', title: '下へ', onclick: () => move(i, 1) }, '↓'),
              h('button', { class: 'icon-btn', title: '削除', onclick: () => updateCombo(id, (c) => c.entries.splice(i, 1)) }, '×'))))))),
    h('div', { class: 'combo-footer' },
      h('label', {}, 'ローテーション時間（秒）',
        h('input', {
          type: 'number', min: 0, step: 0.5, value: combo.duration ?? '', placeholder: `自動（${(Math.round(r.totalTime * 100) / 100)}）`,
          onchange: (e) => updateCombo(id, (c) => { c.duration = Number(e.target.value) > 0 ? Number(e.target.value) : null; }),
        })),
      h('span', { class: 'muted small' }, '空欄ならコンボの合計時間で割ります。控えで戦うキャラは20秒などを指定してください。')),
    h('div', { class: 'saved-combos' },
      h('div', { class: 'inline-form' },
        nameInput,
        h('button', {
          class: 'btn btn-small', onclick: () => {
            const name = nameInput.value.trim() || `コンボ ${combos.saved.length + 1}`;
            updateCombo(id, (c, all) => { all.saved.push({ name, combo: structuredClone(c), savedAt: new Date().toISOString() }); });
            toast(`「${name}」を保存しました。`, 'success');
          },
        }, 'コンボを保存')),
      combos.saved.length > 0 && h('ul', { class: 'saved-list' }, combos.saved.map((s, i) => {
        const dps = evaluateCombo(st.engine, s.combo).dps;
        return h('li', {},
          h('span', {}, s.name), h('span', { class: 'muted' }, `DPS ${fmt(dps)}`),
          h('button', { class: 'btn btn-small', onclick: () => updateCombo(id, (c, all) => { all.current = structuredClone(s.combo); }) }, '読み込む'),
          h('button', { class: 'btn btn-small btn-danger', onclick: () => updateCombo(id, (c, all) => { all.saved.splice(i, 1); }) }, '削除'));
      }))),
  );
}

// --- 推奨コンボ ---
function recommendPanel(st) {
  const { id, engine } = st;
  const rec = ui.recommendation?.id === id ? ui.recommendation.rec : null;
  const lengthInput = h('input', { type: 'number', min: 5, max: 60, step: 1, value: ui.recLength, placeholder: '自動' });
  const box = h('section', { class: 'card recommend' },
    h('h3', {}, '推奨コンボ'),
    h('p', { class: 'muted small' }, '現在のステータス・バフ・天賦レベルから、元素爆発 → 元素スキル（CDの許す回数）→ 残り時間を最もDPS効率の高い通常攻撃パターンで埋める、という方針で自動生成します。'),
    h('div', { class: 'inline-form' },
      h('label', {}, 'ローテーション秒数 ', lengthInput),
      h('button', {
        class: 'btn btn-primary', onclick: () => {
          ui.recLength = lengthInput.value;
          ui.recommendation = { id, rec: recommendCombo(engine, { rotationLength: Number(lengthInput.value) || undefined }) };
          renderCalc();
        },
      }, '推奨コンボを生成')));
  if (rec) {
    const r = evaluateCombo(engine, rec.combo);
    box.append(
      h('div', { class: 'rec-sequence' }, rec.sequence),
      h('div', { class: 'rec-kpi' }, `予想DPS ${fmt(r.dps)} ・ 合計 ${fmt(r.totalDamage)} ・ ${sec(r.duration)}`),
      h('ul', { class: 'rec-notes' }, rec.notes.map((n) => h('li', {}, n))),
      rec.alternatives.map((alt) => h('details', { class: 'help' },
        h('summary', {}, `${alt.title}のパターン比較`),
        h('table', { class: 'mini-table' }, h('tbody', {}, alt.candidates.map((c, i) => h('tr', { class: i === 0 ? 'best' : '' },
          h('td', {}, c.label), h('td', { class: 'num' }, `${fmt(c.dps)}/秒`), h('td', { class: 'num' }, sec(c.time)))))))),
      h('div', { class: 'row-actions' },
        h('button', {
          class: 'btn btn-primary', onclick: () => {
            updateCombo(id, (c, all) => { all.current = structuredClone(rec.combo); });
            toast('推奨コンボを適用しました。', 'success');
          },
        }, 'このコンボを適用')),
    );
  }
  return box;
}

// --- アクション一覧 ---
function actionPanel(st) {
  const { id, engine } = st;
  const filter = ui.actionFilter;
  const tabs = [['all', 'すべて'], ['normal', '通常攻撃'], ['skill', '元素スキル'], ['burst', '元素爆発']];
  const visible = engine.actions.filter((a) => filter === 'all' || a.talent === filter || (a.kind === 'wait' && filter === 'all'));
  const groups = {};
  for (const a of visible) (groups[a.talent ?? 'other'] ??= []).push(a);
  const talentName = (t) => (t === 'other' ? 'その他' : `${TALENT_JA[t]}「${st.charData.talents[t]?.name ?? ''}」 Lv.${engine.ctx.talentLevels[t]}`);
  return h('section', { class: 'card' },
    h('div', { class: 'section-head small' },
      h('h3', {}, 'アクション'),
      h('div', { class: 'seg-control' }, tabs.map(([k, l]) => h('button', {
        class: filter === k ? 'active' : '', onclick: () => { ui.actionFilter = k; renderCalc(); },
      }, l)))),
    h('p', { class: 'muted small' }, 'クリックでコンボに追加します。数値は1回あたりの期待値（会心込み）です。'),
    Object.entries(groups).map(([t, actions]) => h('div', { class: 'action-group' },
      h('h4', {}, talentName(t)),
      h('div', { class: 'action-list' }, actions.map((a) => {
        const d = engine.damageOf(a);
        return h('button', {
          class: 'action-btn', title: a.hits.length ? `非会心 ${fmt(d.nonCrit)} / 会心 ${fmt(d.crit)} / 目安時間 ${sec(a.defaultTime)}` : `目安時間 ${sec(a.defaultTime)}`,
          onclick: () => {
            updateCombo(id, (c) => {
              const last = c.entries[c.entries.length - 1];
              if (last && last.actionId === a.id) last.count += 1;
              else c.entries.push({ actionId: a.id, count: 1, reaction: 'auto' });
            });
          },
        },
        h('span', { class: 'action-name' }, a.nameJa),
        h('span', { class: 'action-meta' },
          a.hits.length ? [...new Set(a.hits.map((x) => x.element))].map(elementBadge) : null,
          a.hits.length ? h('span', { class: 'num' }, fmt(d.avg)) : h('span', { class: 'muted' }, sec(a.defaultTime))));
      })))),
  );
}

init();
