// Enka.Network API の CORS プロキシ（Cloudflare Workers 用）
// GitHub Pages など静的ホスティングで公開したサイトから UID のデータを取得するために使います。
//
//   GET https://<worker>.workers.dev/<UID>  →  https://enka.network/api/uid/<UID>/
//
// 環境変数:
//   ALLOWED_ORIGINS  許可するオリジン（カンマ区切り。例: https://user.github.io）。未設定なら全オリジン許可
//   USER_AGENT       Enka に送る User-Agent
const ENKA = 'https://enka.network/api/uid';
const UID_RE = /^(18|[1-9])\d{8}$/;

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : null;
  const h = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Accept', Vary: 'Origin' };
  if (allow) h['Access-Control-Allow-Origin'] = allow;
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed', status: 405 }, 405, cors);
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ error: 'Origin not allowed', status: 403 }, 403, cors);

    const uid = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
    if (!UID_RE.test(uid)) return json({ error: 'UIDの形式が正しくありません。', status: 400 }, 400, cors);

    // Enka の ttl に従ってエッジでキャッシュする
    const cache = caches.default;
    const cacheKey = new Request(`${ENKA}/${uid}/`);
    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Response(hit.body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT', ...cors } });
    }

    let res;
    try {
      res = await fetch(`${ENKA}/${uid}/`, {
        headers: { 'User-Agent': env.USER_AGENT || 'GenshinDPS-Proxy/0.1 (+https://github.com/mizugamiaqua/GenshinDPS)', Accept: 'application/json' },
      });
    } catch {
      return json({ error: 'Enka.Network に接続できませんでした。', status: 502 }, 502, cors);
    }
    if (!res.ok) return json({ error: `Enka.Network: HTTP ${res.status}`, status: res.status }, res.status, cors);

    const text = await res.text();
    let ttl = 60;
    try {
      ttl = Math.max(30, Number(JSON.parse(text).ttl) || 60);
    } catch {
      return json({ error: 'Enka.Network から不正なレスポンスを受け取りました。', status: 502 }, 502, cors);
    }
    ctx.waitUntil(cache.put(cacheKey, new Response(text, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
    })));
    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS', ...cors } });
  },
};
