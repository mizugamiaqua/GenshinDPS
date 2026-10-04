// サイト設定。GitHub Pages へのデプロイ時は Actions がこのファイルを上書きします
// （リポジトリ変数 ENKA_PROXY_URL が設定されていれば enkaProxy に入ります）。
window.GENSHIN_DPS_CONFIG = {
  // Enka.Network 用 CORS プロキシのURL（例: https://enka-proxy.example.workers.dev）
  enkaProxy: '',
  // 同一オリジンの /api/enka を使うか（server.js で起動している場合）
  sameOriginApi: true,
};
