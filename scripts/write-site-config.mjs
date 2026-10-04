// 静的ホスティング（GitHub Pages）用の public/config.js を生成する
//   ENKA_PROXY_URL=https://xxx.workers.dev node scripts/write-site-config.mjs public/config.js
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'public/config.js';
const config = {
  enkaProxy: (process.env.ENKA_PROXY_URL ?? '').trim(),
  // 静的ホスティングには /api/enka が無いので使わない
  sameOriginApi: false,
};
writeFileSync(out, `// このファイルはデプロイ時に自動生成されています\nwindow.GENSHIN_DPS_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
console.log(`wrote ${out}:`, config);
