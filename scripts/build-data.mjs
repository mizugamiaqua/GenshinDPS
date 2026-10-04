// キャラクター・天賦倍率データを生成するスクリプト
//   npm run build:data
// 入力:
//   - genshin-db（npm, devDependency）: 天賦倍率・日本語名
//   - Enka.Network store（GitHub）: avatarId とスキルIDの対応、名前ローカライズ
//     新形式 store/gi/avatars.json・locs.json を優先し、旧形式 characters.json・loc.json で補う
//   - Enka store に未登録の新キャラも genshin-db にあれば収録する（スキルIDは実行時に推定）
// 出力:
//   - public/data/characters.json
//   - public/data/loc.json
//   - public/data/meta.json（聖遺物セット・武器の補助辞書）
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTalent } from '../public/js/core/talentParser.js';

const require = createRequire(import.meta.url);
const gdb = require('genshin-db');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, 'public', 'data');
const STORE = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store';

const ENKA_ELEMENT = {
  Fire: 'pyro', Water: 'hydro', Wind: 'anemo', Electric: 'electro',
  Grass: 'dendro', Ice: 'cryo', Rock: 'geo',
};
const GDB_ELEMENT = {
  ELEMENT_PYRO: 'pyro', ELEMENT_HYDRO: 'hydro', ELEMENT_ANEMO: 'anemo', ELEMENT_ELECTRO: 'electro',
  ELEMENT_DENDRO: 'dendro', ELEMENT_CRYO: 'cryo', ELEMENT_GEO: 'geo',
};
const TRAVELER_SUFFIX = {
  pyro: 'Pyro', hydro: 'Hydro', anemo: 'Anemo', electro: 'Electro', dendro: 'Dendro', cryo: 'Cryo', geo: 'Geo',
};

async function fetchStore(file) {
  const cached = join(CACHE, file.replaceAll('/', '_'));
  if (existsSync(cached) && !process.argv.includes('--refresh')) {
    return JSON.parse(await readFile(cached, 'utf8'));
  }
  const res = await fetch(`${STORE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, text);
  return JSON.parse(text);
}

function talentsFor(name) {
  const en = gdb.talents(name);
  const ja = gdb.talents(name, { resultLanguage: 'Japanese' });
  if (!en) return null;
  return {
    normal: parseTalent('normal', en.combat1, ja?.combat1),
    skill: parseTalent('skill', en.combat2, ja?.combat2),
    burst: parseTalent('burst', en.combat3, ja?.combat3),
  };
}

/** 新形式のアイコン表記 "/ui/UI_AvatarIcon_Side_X.png" → "UI_AvatarIcon_Side_X" */
const iconName = (v) => (v ? String(v).replace(/^\/ui\//, '').replace(/\.png$/, '') : null);

async function main() {
  // 新形式を優先し、旧形式にしか無いエントリで補完
  const legacyChars = await fetchStore('characters.json');
  const newChars = await fetchStore('gi/avatars.json');
  const enkaChars = { ...legacyChars, ...newChars };
  const legacyLoc = await fetchStore('loc.json');
  const newLoc = await fetchStore('gi/locs.json');
  const loc = {
    ja: { ...legacyLoc.ja, ...newLoc.ja },
    en: { ...legacyLoc.en, ...newLoc.en },
  };

  // genshin-db のキャラクターを avatarId で引けるようにする
  const byId = new Map();
  for (const name of gdb.characters('names', { matchCategories: true })) {
    const en = gdb.characters(name);
    const ja = gdb.characters(name, { resultLanguage: 'Japanese' });
    if (en) byId.set(en.id, { en, ja });
  }

  const out = {};
  const skipped = [];
  for (const [key, ec] of Object.entries(enkaChars)) {
    if (!ec.Element || !ec.SkillOrder) continue;
    const avatarId = Number(key.split('-')[0]);
    const g = byId.get(avatarId);
    if (!g) {
      skipped.push(key);
      continue;
    }
    const element = ENKA_ELEMENT[ec.Element] ?? GDB_ELEMENT[g.en.elementType];
    const isTraveler = avatarId === 10000005 || avatarId === 10000007;
    const talentName = isTraveler ? `Traveler (${TRAVELER_SUFFIX[element]})` : g.en.name;
    const talents = talentsFor(talentName);
    if (!talents) {
      skipped.push(key);
      continue;
    }
    const nameJa = isTraveler
      ? `${g.ja?.name ?? g.en.name}（${loc.ja[`FIGHT_PROP_${{ pyro: 'FIRE', hydro: 'WATER', anemo: 'WIND', electro: 'ELEC', dendro: 'GRASS', cryo: 'ICE', geo: 'ROCK' }[element]}_ADD_HURT`]?.replace(/ダメージ.*$/, '') ?? element}）`
      : g.ja?.name ?? g.en.name;

    out[key] = {
      avatarId,
      key: g.en.name,
      nameJa,
      nameEn: isTraveler ? talentName : g.en.name,
      element,
      weaponType: ec.WeaponType ?? g.en.weaponType,
      rarity: g.en.rarity,
      icon: iconName(ec.SideIconName),
      skillOrder: ec.SkillOrder,
      proudMap: ec.ProudMap ?? {},
      talents,
    };
  }

  // Enka store に未登録の新キャラ（genshin-db には存在）も収録する。
  // スキルID（skillOrder）が不明なので、実行時に skillLevelMap のID順から推定する
  const covered = new Set(Object.values(out).map((c) => c.avatarId));
  const added = [];
  for (const [avatarId, g] of byId) {
    if (covered.has(avatarId) || avatarId === 10000005 || avatarId === 10000007) continue;
    const talents = talentsFor(g.en.name);
    if (!talents || !GDB_ELEMENT[g.en.elementType]) continue;
    out[String(avatarId)] = {
      avatarId,
      key: g.en.name,
      nameJa: g.ja?.name ?? g.en.name,
      nameEn: g.en.name,
      element: GDB_ELEMENT[g.en.elementType],
      weaponType: g.en.weaponType,
      rarity: g.en.rarity,
      icon: g.en.images?.filename_sideIcon ?? null,
      skillOrder: null,
      proudMap: {},
      talents,
    };
    added.push(g.en.name);
  }

  // ローカライズは日本語・英語だけに絞る
  const locOut = { ja: loc.ja, en: loc.en };

  // Enka の辞書に無い新しい武器・聖遺物セット用の補助辞書（アイコン名/IDから引く）
  const sets = {};
  for (const name of gdb.artifacts('names', { matchCategories: true })) {
    const en = gdb.artifacts(name);
    const ja = gdb.artifacts(name, { resultLanguage: 'Japanese' });
    if (en?.id) sets[en.id] = { en: en.name, ja: ja?.name ?? en.name };
  }
  const weapons = {};
  for (const name of gdb.weapons('names', { matchCategories: true })) {
    const en = gdb.weapons(name);
    const ja = gdb.weapons(name, { resultLanguage: 'Japanese' });
    if (en?.id) weapons[en.id] = { en: en.name, ja: ja?.name ?? en.name, rarity: en.rarity };
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'characters.json'), JSON.stringify(out));
  await writeFile(join(OUT, 'loc.json'), JSON.stringify(locOut));
  await writeFile(join(OUT, 'meta.json'), JSON.stringify({ sets, weapons, generatedAt: new Date().toISOString() }));

  const rowCount = Object.values(out).reduce(
    (n, c) => n + c.talents.normal.rows.length + c.talents.skill.rows.length + c.talents.burst.rows.length,
    0,
  );
  console.log(`characters: ${Object.keys(out).length} (damage rows: ${rowCount})`);
  if (added.length) console.log(`added from genshin-db only: ${added.join(', ')}`);
  if (skipped.length) console.log(`skipped (no data): ${skipped.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
