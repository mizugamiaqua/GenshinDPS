// Enka.Network のデータ取得。
// Enka.Network はブラウザからの直接アクセス（CORS）を許可していないため、次の経路を使う:
//   1. 同一オリジンの API（npm start で起動した server.js がある場合）
//   2. GitHub に保存済みのデータ（GitHub Actions が取得して enka-data ブランチに保存したもの）
//      → 無ければ GitHub Issue で取得を依頼し、保存されるのを待つ
import { ENKA_ERRORS } from './core/enka.js';

export const ENKA_API = 'https://enka.network/api/uid';
export const GITHUB_DEFAULTS = {
  apiBase: 'https://api.github.com',
  rawBase: 'https://raw.githubusercontent.com',
  webBase: 'https://github.com',
  branch: 'enka-data',
};

export class EnkaError extends Error {
  /**
   * @param {string} message
   * @param {number|null} status
   * @param {'enka'|'not-cached'|'unavailable'|'timeout'|'cancelled'} code
   */
  constructor(message, status = null, code = 'enka', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/** GitHub Pages の URL（owner.github.io/repo/）からリポジトリ名を推定 */
export function detectGitHubRepo(loc) {
  const m = /^([^.]+)\.github\.io$/i.exec(loc?.hostname ?? '');
  if (!m) return null;
  const repo = (loc.pathname ?? '/').split('/').filter(Boolean)[0];
  return repo ? `${m[1]}/${repo}` : `${m[1]}/${m[1]}.github.io`;
}

export function githubConfig(siteConfig = {}, loc = globalThis.location) {
  const gh = { ...GITHUB_DEFAULTS, ...(siteConfig.github ?? {}) };
  gh.repo = gh.repo || detectGitHubRepo(loc);
  return gh.repo ? gh : null;
}

/** 取得依頼用の Issue 作成URL（タイトル・本文入り） */
export function issueUrl(uid, gh) {
  const params = new URLSearchParams({
    title: `[UID] ${uid}`,
    body: `UID: ${uid}\n\nこのまま「Create」（Submit new issue）を押してください。GitHub Actions が Enka.Network からデータを取得し、完了するとこの Issue は自動で閉じられます。`,
  });
  return `${gh.webBase}/${gh.repo}/issues/new?${params}`;
}

const isJson = (res) => /json/i.test(res.headers.get('content-type') ?? '');

/** 1. 同一オリジンの API。経路が無ければ null */
export async function fetchFromServer(uid, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`api/enka/${uid}`, { headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!isJson(res)) return null; // 静的ホスティングの404ページなど
  let body;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  if (res.ok) return { json: body, via: 'server' };
  throw new EnkaError(ENKA_ERRORS[res.status] ?? body?.error ?? `取得に失敗しました（HTTP ${res.status}）`, res.status);
}

/**
 * 2. GitHub に保存済みのデータ。無ければ null
 * api.github.com（キャッシュが短い）を優先し、レート制限時は raw.githubusercontent.com を使う
 */
export async function fetchFromGitHub(uid, gh, fetchImpl = fetch) {
  const path = `uid/${uid}.json`;
  const bust = `t=${Date.now()}`;
  const tries = [
    { url: `${gh.apiBase}/repos/${gh.repo}/contents/${path}?ref=${gh.branch}&${bust}`, headers: { Accept: 'application/vnd.github.raw+json' } },
    { url: `${gh.rawBase}/${gh.repo}/${gh.branch}/${path}?${bust}`, headers: {} },
  ];
  for (const t of tries) {
    let res;
    try {
      res = await fetchImpl(t.url, { headers: t.headers, cache: 'no-store' });
    } catch {
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) continue; // レート制限など → 次の経路
    try {
      return JSON.parse(await res.text());
    } catch {
      continue;
    }
  }
  return null;
}

const hasPlayer = (rec) => !!rec?.playerInfo;

/**
 * UID のデータを取得
 * @returns {Promise<{json:object, via:'server'|'github', fetchedAt?:string}>}
 */
export async function fetchEnkaData(uid, { sameOrigin = true, github = null } = {}, fetchImpl = fetch) {
  if (sameOrigin) {
    const r = await fetchFromServer(uid, fetchImpl);
    if (r) return r;
  }
  if (github) {
    const rec = await fetchFromGitHub(uid, github, fetchImpl);
    if (hasPlayer(rec)) return { json: rec, via: 'github', fetchedAt: rec._meta?.fetchedAt ?? null };
    throw new EnkaError('このUIDのデータはまだ取得されていません。', null, 'not-cached', { lastError: rec?._meta?.lastError ?? null });
  }
  throw new EnkaError('Enka.Network に接続できる経路がありません。JSONを直接読み込んでください。', null, 'unavailable');
}

/**
 * GitHub Actions がデータを保存するのを待つ
 * since 以降に取得（または失敗）した記録が現れたら返す
 */
export async function waitForGitHub(uid, gh, since, { interval = 10000, timeout = 6 * 60 * 1000, signal, onTick } = {}, fetchImpl = fetch) {
  const start = Date.now();
  const sinceMs = new Date(since).getTime() - 5000;
  for (let n = 0; ; n++) {
    if (signal?.aborted) throw new EnkaError('キャンセルしました。', null, 'cancelled');
    const rec = await fetchFromGitHub(uid, gh, fetchImpl);
    const fetchedAt = rec?._meta?.fetchedAt ? new Date(rec._meta.fetchedAt).getTime() : 0;
    const errorAt = rec?._meta?.lastError?.at ? new Date(rec._meta.lastError.at).getTime() : 0;
    if (hasPlayer(rec) && fetchedAt >= sinceMs) return { json: rec, via: 'github', fetchedAt: rec._meta.fetchedAt };
    if (errorAt >= sinceMs && errorAt > fetchedAt) {
      const e = rec._meta.lastError;
      throw new EnkaError(e.message ?? '取得に失敗しました。', e.status ?? null, 'enka');
    }
    if (Date.now() - start > timeout) {
      throw new EnkaError('時間内にデータが届きませんでした。Issue のコメントを確認するか、もう一度お試しください。', null, 'timeout');
    }
    onTick?.(n, Date.now() - start);
    await new Promise((resolve) => {
      const t = setTimeout(resolve, interval);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
}
