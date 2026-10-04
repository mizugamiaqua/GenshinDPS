import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES } from '../public/js/core/profiles.js';
import { db } from './helpers.js';

test('プロファイルのヒット数定義が実在する天賦行を指している', () => {
  const ctx = { constellation: 0 };
  for (const [key, p] of Object.entries(PROFILES)) {
    const c = Object.values(db.characters).find((x) => x.key === key);
    assert.ok(c, `キャラが見つからない: ${key}`);
    const names = new Set(['normal', 'skill', 'burst'].flatMap((t) => c.talents[t].rows.map((r) => r.nameEn.replace(/ \[.*\]$/, ''))));
    for (const row of Object.keys(p.hitCounts?.(ctx) ?? {})) assert.ok(names.has(row), `${key}: ${row}`);
  }
});
