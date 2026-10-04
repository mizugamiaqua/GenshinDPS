// サイト設定。GitHub Pages へのデプロイ時は Actions がこのファイルを上書きします。
window.GENSHIN_DPS_CONFIG = {
  // 同一オリジンの /api/enka を使うか（npm start で server.js を起動している場合）
  sameOriginApi: true,
  // Enka データの保存先リポジトリ（"owner/repo"）。空なら github.io のURLから自動判定
  github: { repo: '', branch: 'enka-data' },
};
