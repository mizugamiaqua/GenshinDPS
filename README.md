# 原神 DPS 計算機

UID を入力するだけで、プロフィールの「キャラクターラインナップ」からキャラのレベル・天賦・武器・聖遺物を自動取得し、
通常攻撃・元素スキル・元素爆発を組み合わせたコンボの DPS を計算する Web アプリです。
推奨コンボの自動生成にも対応しています。

## 使い方

```bash
npm install        # データ生成用（genshin-db）。起動だけなら不要
npm start          # http://localhost:3000
npm test           # テスト
```

1. **UIDから読み込み** — UID を入力するとキャラ詳細を取得します（ゲーム内で「キャラ詳細を表示」をONにしたキャラのみ）。
2. **登録** — 計算したいキャラを選んで登録します。ブラウザ（localStorage）に保存され、「最新に更新」で再取得できます。
3. **DPS計算** — アクション一覧から通常攻撃・重撃・スキル・爆発をクリックしてコンボを組むと、合計ダメージ・DPS を表示します。
   - 回数・1回あたりの時間・元素反応（蒸発/溶解/超激化/草激化）はアクションごとに変更可能
   - 聖遺物セット効果は装備から自動検出、チームバフ（ベネット・万葉・鍾離など）はチェックで追加
   - 武器効果や命ノ星座など自動化していない効果は「カスタム」に手入力
4. **推奨コンボ** — 元素スキル（CDが許す回数）→ 元素爆発 → 特殊状態中の攻撃 → 残り時間を最もDPS効率の良い
   通常攻撃パターンで埋める、という方針で自動生成します。パターン比較も表示します。

## GitHub Pages で公開する

`public/` は静的ファイルだけで動くので、GitHub Pages で公開できます。
デフォルトブランチに push すると `.github/workflows/pages.yml` がテスト → デプロイを自動で行います。

1. **Pages を有効化**: リポジトリの Settings → Pages → Build and deployment の Source を **GitHub Actions** にする
2. **push する**（または Actions タブから「Test & Deploy to GitHub Pages」を手動実行）
   → `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

### Enka 用プロキシ（UID読み込みに必要）

GitHub Pages にはサーバーが無く、ブラウザから Enka.Network を直接呼ぶと CORS で拒否されるため、
UID から読み込むには CORS 対応のプロキシが必要です。リポジトリ同梱の Cloudflare Worker（無料枠で動作）を使えます。

```bash
cd workers/enka-proxy
npx wrangler login
npx wrangler deploy        # → https://genshin-dps-enka-proxy.<アカウント>.workers.dev
```

デプロイしたURLを次のどちらかで設定します。

- **サイト全体の既定にする**: Settings → Secrets and variables → Actions → Variables に
  `ENKA_PROXY_URL` を追加して再デプロイ（`public/config.js` に書き込まれます）
- **自分のブラウザだけで使う**: サイトの「UIDから読み込み」→「接続設定」にURLを入力して保存

`wrangler.toml` の `ALLOWED_ORIGINS` に `https://<ユーザー名>.github.io` を入れると、自分のサイト以外からの利用を防げます。
プロキシを用意しない場合も、「JSONを直接読み込む」に Enka の JSON を貼り付ければ計算できます。

取得経路は「同一オリジンの `/api/enka`（`npm start` 時）→ 設定したプロキシ → Enka 直接」の順に自動で試します。

## 仕組み

| ファイル | 役割 |
| --- | --- |
| `server.js` | 静的配信 + `/api/enka/:uid`（Enka.Network API のプロキシ。CORS回避・User-Agent付与・ttlキャッシュ） |
| `workers/enka-proxy/` | GitHub Pages 用の Enka プロキシ（Cloudflare Worker） |
| `.github/workflows/pages.yml` | テストと GitHub Pages へのデプロイ |
| `public/js/enkaClient.js` | Enka 取得（同一オリジン → プロキシ → 直接 のフォールバック） |
| `scripts/build-data.mjs` | genshin-db と Enka store から全キャラの天賦倍率を抽出し `public/data/*.json` を生成（`npm run build:data`） |
| `public/js/core/talentParser.js` | 天賦ラベル（例 `5-Hit DMG\|{param5:F1P}+{param6:F1P}`）を倍率・参照ステータス・ヒット数に変換 |
| `public/js/core/enka.js` | Enka レスポンスの正規化（パネルステータス・天賦Lv（凸による+3込み）・武器・聖遺物） |
| `public/js/core/damage.js` | ダメージ式（防御・耐性補正、会心期待値、増幅反応、激化） |
| `public/js/core/buffs.js` | 聖遺物セット効果・チームバフ・カスタムバフ |
| `public/js/core/profiles.js` | キャラ別の自己バフ・持続ダメージ回数・定番パターン（胡桃、雷電、香菱、綾華、ナヒーダ、エウルア、甘雨、ヌヴィレット、夜蘭、マーヴィカ） |
| `public/js/core/rotation.js` | コンボ評価・推奨コンボ生成 |
| `public/js/app.js` | UI |

ゲームのアップデートで新キャラが追加されたら `npm update genshin-db && npm run build:data -- --refresh` でデータを更新してください。
プロファイルが無いキャラも汎用ロジックで計算・推奨コンボ生成ができます。

環境変数: `PORT`（既定 3000）、`ENKA_BASE`（Enka API のベースURL）、`ENKA_USER_AGENT`。

## 注意・制限

- Enka.Network はブラウザから直接呼べないため、付属のサーバーまたはプロキシ経由で取得します。
- モーション時間は武器種ごとの目安値です。持続ダメージのヒット数はプロファイル未定義のキャラでは1回として扱います（コンボ表で変更可）。
- 武器パッシブの条件付き効果、命ノ星座（一部を除く）、変化反応・月反応は未対応です（カスタムバフで補正できます）。
- Lv91 以降の反応係数は暫定値（外挿）です。
