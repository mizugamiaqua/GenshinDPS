// Enka.Network からのデータ取得。
// 動作環境によって使える経路が違うため、以下の順に試す:
//   1. 同一オリジンの API（npm start で起動した server.js）
//   2. 設定されたプロキシ（GitHub Pages 等の静的ホスティング用。Cloudflare Worker など）
//   3. Enka.Network への直接アクセス（CORS が許可されている場合のみ成功）
// 「その経路が無い」（404のHTML・ネットワークエラー・CORSエラー）なら次へ進み、
// Enka 自体のエラー（プレイヤーが存在しない等）が返った時点で打ち切る。
import { ENKA_ERRORS } from './core/enka.js';

export const ENKA_DIRECT = 'https://enka.network/api/uid';

export class EnkaError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** 試す取得先URLの一覧 */
export function endpoints(uid, { proxy = '', sameOrigin = true, direct = true } = {}) {
  const list = [];
  if (sameOrigin) list.push({ kind: 'server', url: `api/enka/${uid}` });
  const p = String(proxy ?? '').trim();
  if (p) {
    // "{uid}" を含む場合は置換、含まない場合は末尾に付ける
    const url = p.includes('{uid}') ? p.replaceAll('{uid}', uid) : `${p.replace(/\/+$/, '')}/${uid}`;
    list.push({ kind: 'proxy', url });
  }
  if (direct) list.push({ kind: 'direct', url: `${ENKA_DIRECT}/${uid}/` });
  return list;
}

const isJson = (res) => /json/i.test(res.headers.get('content-type') ?? '');

/**
 * UID のデータを取得
 * @returns {Promise<{json:object, via:string}>}
 */
export async function fetchEnkaData(uid, opts = {}, fetchImpl = fetch) {
  const tried = [];
  for (const ep of endpoints(uid, opts)) {
    let res;
    try {
      res = await fetchImpl(ep.url, { headers: { Accept: 'application/json' } });
    } catch {
      tried.push(ep.kind);
      continue; // ネットワークエラー・CORS拒否
    }
    if (!isJson(res)) {
      // 静的ホスティングの404ページなど＝この経路は存在しない
      tried.push(ep.kind);
      continue;
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      tried.push(ep.kind);
      continue;
    }
    if (res.ok) return { json: body, via: ep.kind };
    // サーバー/プロキシが Enka のエラーをそのまま中継している
    if ([400, 404, 424, 429].includes(res.status) || body?.status) {
      throw new EnkaError(ENKA_ERRORS[res.status] ?? body?.error ?? `取得に失敗しました（HTTP ${res.status}）`, res.status);
    }
    tried.push(ep.kind);
  }
  const hint = opts.proxy
    ? '設定したプロキシURLが正しいか確認してください。'
    : 'このサイトにはAPIサーバーが無いため、「接続設定」でEnka用プロキシURLを設定するか、JSONを直接読み込んでください。';
  throw new EnkaError(`Enka.Network に接続できませんでした。${hint}`, null);
}
