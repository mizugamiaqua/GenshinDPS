// localStorage への保存（登録キャラ・計算設定・コンボ）
const KEY = 'genshin-dps:v1';

function empty() {
  return { characters: {}, settings: {}, combos: {}, lastUid: '', proxyUrl: '' };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('保存に失敗しました', err);
  }
}

export const buildId = (build) => `${build.uid ?? 'manual'}:${build.charKey ?? build.avatarId}`;

export const store = {
  get lastUid() {
    return state.lastUid;
  },
  set lastUid(v) {
    state.lastUid = v;
    save();
  },
  get proxyUrl() {
    return state.proxyUrl;
  },
  set proxyUrl(v) {
    state.proxyUrl = v;
    save();
  },
  listCharacters() {
    return Object.entries(state.characters)
      .map(([id, build]) => ({ id, build }))
      .sort((a, b) => (b.build.fetchedAt ?? '').localeCompare(a.build.fetchedAt ?? ''));
  },
  getCharacter(id) {
    return state.characters[id] ?? null;
  },
  /** 登録（同じUID・キャラは上書き更新） */
  saveCharacter(build) {
    const id = buildId(build);
    state.characters[id] = build;
    save();
    return id;
  },
  removeCharacter(id) {
    delete state.characters[id];
    delete state.settings[id];
    delete state.combos[id];
    save();
  },
  getSettings(id) {
    return state.settings[id] ?? {};
  },
  saveSettings(id, settings) {
    state.settings[id] = settings;
    save();
  },
  getCombos(id) {
    return state.combos[id] ?? { current: null, saved: [] };
  },
  saveCombos(id, combos) {
    state.combos[id] = combos;
    save();
  },
  exportAll() {
    return JSON.stringify(state, null, 2);
  },
  importAll(json) {
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object' || !data.characters) throw new Error('形式が正しくありません');
    state = { ...empty(), ...data };
    save();
  },
};
