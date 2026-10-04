// 静的ホスティング（GitHub Pages）用の public/config.js を生成する
//   GITHUB_REPOSITORY=owner/repo node scripts/write-site-config.mjs public/config.js
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'public/config.js';
const config = {
  // 静的ホスティングには /api/enka が無いので使わない
  sameOriginApi: false,
  // Enka データの保存先（GitHub Actions の Fetch Enka data が更新する）
  github: {
    repo: process.env.GITHUB_REPOSITORY ?? '',
    branch: 'enka-data',
  },
};
writeFileSync(out, `// このファイルはデプロイ時に自動生成されています\nwindow.GENSHIN_DPS_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
console.log(`wrote ${out}:`, config);
