# 原神 DPS 計算機

UID を入力するだけで、プロフィールの「キャラクターラインナップ」からキャラのレベル・天賦・武器・聖遺物を自動取得し、
通常攻撃・元素スキル・元素爆発を組み合わせたコンボの DPS を計算する Web アプリです。
推奨コンボの自動生成、4人チームのローテーションDPS計算にも対応しています。

## 🔗 サイトはこちら

### **[https://mizugamiaqua.github.io/GenshinDPS/](https://mizugamiaqua.github.io/GenshinDPS/)**

インストール不要・ブラウザだけで使えます（PC・スマホ対応）。

| ページ | リンク |
| --- | --- |
| UIDから読み込み | [https://mizugamiaqua.github.io/GenshinDPS/#/import](https://mizugamiaqua.github.io/GenshinDPS/#/import) |
| 登録キャラ | [https://mizugamiaqua.github.io/GenshinDPS/#/roster](https://mizugamiaqua.github.io/GenshinDPS/#/roster) |
| DPS計算 | [https://mizugamiaqua.github.io/GenshinDPS/#/calc](https://mizugamiaqua.github.io/GenshinDPS/#/calc) |
| チームDPS | [https://mizugamiaqua.github.io/GenshinDPS/#/team](https://mizugamiaqua.github.io/GenshinDPS/#/team) |

## 使い方

1. **UIDから読み込み** — UID を入力するとキャラ詳細を取得します（ゲーム内で「キャラ詳細を表示」をONにしたキャラのみ）。
2. **登録** — 計算したいキャラを選んで登録します。ブラウザ（localStorage）に保存され、「最新に更新」で再取得できます。
3. **DPS計算** — アクション一覧から通常攻撃・重撃・スキル・爆発をクリックしてコンボを組むと、合計ダメージ・DPS を表示します。
   - 回数・1回あたりの時間・元素反応（蒸発/溶解/超激化/草激化）はアクションごとに変更可能
   - 聖遺物セット効果は装備から自動検出、チームバフ（ベネット・万葉・鍾離など）はチェックで追加
   - 武器効果や命ノ星座など自動化していない効果は「カスタム」に手入力
4. **チームDPS（4人ローテーション）** — 登録キャラから4人を選ぶと、チームメイトのバフをメンバーの実際の育成状況から自動計算し、
   ローテーション全体のチームDPS・各メンバーのダメージ割合・フィールド時間を表示します。
   - 自動計算するチームバフ: ベネット（基礎攻撃力×爆発倍率）、万葉（熟知×0.04%）、スクロース、ナヒーダ、フリーナ（気炎値）、モナ、
     申鶴（攻撃力×倍率の加算）、雲菫（防御力×倍率）、九条裟羅、鍾離、ファルザン、シロネン、シトラリ、シュヴルーズ、ゴロー、夜蘭、
     コロンビーナ、ラウマ ／ 旧貴族・千岩・教官・翠緑・深林・灰燼の都の4セット ／ 龍殺しの英傑譚 ／ 元素共鳴
   - 「推奨チームローテを生成」で、全員分の行動順と開始秒数を自動作成
     - メインアタッカーは「フィールド時間を任せたときのダメージの伸び」が最も大きいメンバーを自動判定（手動指定も可）
     - 順番は シールド・デバフ → サブアタッカー（設置・控え攻撃）→ バッファー（メインの直前）→ メイン
     - メインは 元素スキル → 元素爆発 → 特殊状態中の攻撃 → 通常攻撃（CDが明けたら元素スキルを再使用）のタイムライン
   - メンバーごとの反応（蒸発など）、コンボの回数・時間は個別に調整可能
5. **推奨コンボ** — 元素スキル → 元素爆発 → 特殊状態中の攻撃 → 最もDPS効率の良い通常攻撃パターン（CDが明けたら元素スキルを再使用）
   という流れで、秒数つきの行動タイムラインを自動生成します。パターン比較も表示します。

## ローカルで動かす（開発者向け）

```bash
npm install        # データ生成用（genshin-db）。起動だけなら不要
npm start          # http://localhost:3000
npm test           # テスト
```

## GitHub Pages で公開する（GitHub だけで完結）

外部サービスの登録は不要で、GitHub Pages + GitHub Actions だけで動きます。

1. Settings → Pages → Build and deployment の Source を **GitHub Actions** にする
2. デフォルトブランチに push すると `.github/workflows/pages.yml` がテスト → デプロイを行い、
   `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

### UID 読み込みの仕組み

Enka.Network はブラウザからの直接アクセス（CORS）を許可していないため、GitHub Actions が代わりに取得します。

```
サイトでUID入力
  ├─ enka-data ブランチに保存済み → すぐ表示（取得日時を表示、「最新データを取得する」で更新）
  └─ 未保存 → 「GitHubで取得を依頼する」
        → タイトル「[UID] 123456789」の Issue 作成画面が開く → 利用者が送信
        → .github/workflows/enka-fetch.yml が Enka から取得し enka-data ブランチの uid/<UID>.json に保存
        → Issue に結果をコメントして自動クローズ
        → サイトが保存を検知して自動で読み込み（通常1分前後）
```

- サイトは保存データを `api.github.com` / `raw.githubusercontent.com`（どちらも CORS 許可）から読みます。
- Issue での依頼には GitHub アカウント（無料）が必要です。アカウントが無い人は、画面の
  「Enka からコピーして貼り付ける」（Enka のJSONを別タブで開いてコピペ）で読み込めます。
- Actions タブの「Fetch Enka data」→「Run workflow」で UID を指定して手動取得もできます。
- 取得したデータは公開ブランチ `enka-data` に保存されます（Enka.Network 上で公開されている情報と同じ内容です）。
- `npm start` でローカル起動した場合は、付属サーバーが直接 Enka から取得します。

## 仕組み

| ファイル | 役割 |
| --- | --- |
| `server.js` | 静的配信 + `/api/enka/:uid`（Enka.Network API のプロキシ。CORS回避・User-Agent付与・ttlキャッシュ） |
| `.github/workflows/pages.yml` | テストと GitHub Pages へのデプロイ |
| `.github/workflows/enka-fetch.yml` + `scripts/enka-fetch.mjs` | Issue をきっかけに Enka からデータを取得し `enka-data` ブランチへ保存 |
| `public/js/enkaClient.js` | データ取得（同一オリジンAPI → GitHub 保存データ → Issue で取得依頼・完了待ち） |
| `scripts/build-data.mjs` | genshin-db と Enka store から全キャラの天賦倍率を抽出し `public/data/*.json` を生成（`npm run build:data`） |
| `public/js/core/talentParser.js` | 天賦ラベル（例 `5-Hit DMG\|{param5:F1P}+{param6:F1P}`）を倍率・参照ステータス・ヒット数に変換 |
| `public/js/core/enka.js` | Enka レスポンスの正規化（パネルステータス・天賦Lv（凸による+3込み）・武器・聖遺物） |
| `public/js/core/damage.js` | ダメージ式（防御・耐性補正、会心期待値、増幅反応、激化） |
| `public/js/core/buffs.js` | 聖遺物セット効果・チームバフ・カスタムバフ |
| `public/js/core/profiles.js` | キャラ別の自己バフ・持続ダメージ回数・定番パターン（胡桃、雷電、香菱、綾華、ナヒーダ、エウルア、甘雨、ヌヴィレット、夜蘭、マーヴィカ） |
| `public/js/core/rotation.js` | コンボ評価・推奨コンボ生成 |
| `public/js/core/team.js` | チームバフの自動計算・チームローテの評価・推奨チームローテ生成 |
| `public/js/app.js` | UI |

ゲームのアップデートで新キャラが追加されたら `npm update genshin-db && npm run build:data -- --refresh` でデータを更新してください。
Enka のキャラ辞書（`store/gi/avatars.json`）にまだ載っていない新キャラも genshin-db にあれば収録され、天賦レベルはスキルIDの並びから推定します。
プロファイルが無いキャラも汎用ロジックで計算・推奨コンボ生成ができます。

環境変数: `PORT`（既定 3000）、`ENKA_BASE`（Enka API のベースURL）、`ENKA_USER_AGENT`。

## 注意・制限

- Enka.Network はブラウザから直接呼べないため、GitHub Actions（公開時）または付属サーバー（ローカル時）経由で取得します。
- モーション時間は武器種ごとの目安値です。持続ダメージのヒット数はプロファイル未定義のキャラでは1回として扱います（コンボ表で変更可）。
- 武器パッシブの条件付き効果、命ノ星座（一部を除く）、変化反応（開花・拡散など）は未対応です（カスタムバフで補正できます）。
- 月反応・星反応として扱われるダメージ（フリンズ、コロンビーナ、オデット、サンドローネ等）は、防御無視・専用バフのみの**概算**です（画面に「概算」と表示）。
- マネキン/マネキナは天賦データが無いため未対応です。
- Lv91 以降の反応係数は暫定値（外挿）です。
