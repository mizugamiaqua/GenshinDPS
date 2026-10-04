import { readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

export const db = {
  characters: load('../public/data/characters.json'),
  loc: load('../public/data/loc.json'),
  meta: load('../public/data/meta.json'),
};
export const sample = load('./fixtures/enka-sample.json');
export const charByName = (name) => Object.values(db.characters).find((c) => c.key === name);
