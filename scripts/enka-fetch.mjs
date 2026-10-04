// GitHub Actions（.github/workflows/enka-fetch.yml）から実行し、
// Enka.Network からプレイヤーデータを取得して enka-data ブランチ用のディレクトリに保存する。
//
// ブラウザからは Enka.Network を直接呼べない（CORS非対応）が、Actions のランナーからは取得できる。
// 保存したファイルは raw.githubusercontent.com / api.github.com（どちらも CORS 許可）経由でサイトから読む。
//
//   node scripts/enka-fetch.mjs <出力ディレクトリ>
//   環境変数: INPUT_UID / ISSUE_TITLE / ISSUE_BODY（いずれかに UID を含む）
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENKA_ERRORS } from '../public/js/core/enka.js';

const ENKA = process.env.ENKA_BASE || 'https://enka.network/api/uid';
const USER_AGENT = 'GenshinDPS/0.1 (+https://github.com/mizugamiaqua/GenshinDPS)';
const UID_RE = /(?<!\d)((?:18|[1-9])\d{8})(?!\d)/;

/** 与えられた文字列のうち最初に見つかった UID を返す */
export function extractUid(...texts) {
  for (const t of texts) {
    const m = UID_RE.exec(String(t ?? ''));
    if (m) return m[1];
  }
  return null;
}

/**
 * 取得結果を保存用データにまとめる
 * - 成功: Enka のレスポンス + _meta.fetchedAt
 * - 失敗: 既存データは残し、_meta.lastError だけ更新
 */
export function buildRecord(existing, result, now = new Date()) {
  const at = now.toISOString();
  if (result.ok) {
    return { ...result.data, _meta: { fetchedAt: at, source: 'github-actions' } };
  }
  const base = existing ?? { uid: result.uid };
  return { ...base, _meta: { ...(existing?._meta ?? { fetchedAt: null }), lastError: { status: result.status, message: result.message, at } } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Enka から取得（429・5xx は少し待って再試行） */
export async function fetchEnka(uid, fetchImpl = fetch, waits = [5000, 15000]) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${ENKA}/${uid}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    } catch (err) {
      if (attempt < waits.length) {
        await sleep(waits[attempt]);
        continue;
      }
      return { ok: false, uid, status: 502, message: `Enka.Network に接続できませんでした（${err.message}）` };
    }
    if (res.ok) {
      try {
        return { ok: true, uid, data: await res.json() };
      } catch {
        return { ok: false, uid, status: 502, message: 'Enka.Network から不正なレスポンスを受け取りました。' };
      }
    }
    if ((res.status === 429 || res.status >= 500) && attempt < waits.length) {
      await sleep(waits[attempt]);
      continue;
    }
    return { ok: false, uid, status: res.status, message: ENKA_ERRORS[res.status] ?? `Enka.Network: HTTP ${res.status}` };
  }
}

async function setOutput(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}<<__EOF__\n${v}\n__EOF__`).join('\n');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(values);
}

async function main() {
  const outDir = process.argv[2] ?? 'enka-data';
  const uid = extractUid(process.env.INPUT_UID, process.env.ISSUE_TITLE, process.env.ISSUE_BODY);
  if (!uid) {
    await setOutput({ ok: 'false', uid: '', changed: 'false', message: 'UID（9〜10桁の数字）が見つかりませんでした。タイトルを「[UID] 800000001」の形式にしてください。' });
    return;
  }
  const file = join(outDir, 'uid', `${uid}.json`);
  let existing = null;
  try {
    existing = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // 初回
  }
  const result = await fetchEnka(uid);
  const record = buildRecord(existing, result);
  await mkdir(join(outDir, 'uid'), { recursive: true });
  await writeFile(file, `${JSON.stringify(record)}\n`);

  const chars = result.ok ? (result.data.avatarInfoList ?? []).length : 0;
  const message = result.ok
    ? chars
      ? `${result.data.playerInfo?.nickname ?? ''} さんのキャラクター ${chars} 体のデータを取得しました。`
      : 'プレイヤーは見つかりましたが、キャラクター詳細が公開されていません。ゲーム内のプロフィールで「キャラ詳細を表示」をONにしてから、もう一度お試しください。'
    : result.message;
  await setOutput({ ok: String(result.ok), uid, changed: 'true', message });
  console.log(`[${uid}] ${message}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
