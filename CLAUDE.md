# 家計簿アプリ 引き継ぎ書（CLAUDE.md）

このファイルは、家計簿Webアプリ開発を Claude Code が引き継ぐための文脈・規約・残作業をまとめたもの。
**このファイルをリポジトリのルートに `CLAUDE.md` として置くと、以後の Claude Code セッションが自動で読み込む。**

---

## 0. これは何か（すぐ作業を始めるための要約）

- 個人専用の家計簿Webアプリ。現行のExcel家計簿を置き換えるのが目的。
- 利用者は1人（オーナーのみ）。Mac/iPhoneのブラウザから使い、データは Supabase で同期。
- すでに **本番稼働中**。基本機能は完成済み。残りは下記「未完了」を順次実装していく。
- 将来的には Apple（SwiftUI）ネイティブ＋Apple Watch へ移行する構想があるため、**データモデルは移植しやすい形を保つ**こと（詳細は §6）。

### リンク／場所
- GitHub リポジトリ: `lorecajp/budget-tracker`（GitHub Pages で公開）
- 公開URL: `https://lorecajp.github.io/budget-tracker/`
- Supabase Project URL: `https://hmmgvqoemblxqqivspvl.supabase.co`
- DBスキーマ定義: リポジトリ内 `schema_supabase.sql`

---

## 1. 技術スタック

- フロント: **Svelte 5（runes: `$state` / `$derived` / `$effect` / `$props`）** + **Vite** + **TypeScript**
- バックエンド: **Supabase**（PostgreSQL + Auth + Row Level Security）。クライアントは `@supabase/supabase-js` v2。
- ホスティング: **GitHub Pages**（`.github/workflows/deploy.yml` の GitHub Actions でビルド＆デプロイ）
- ビルド: `npm run build`（= `vite build`）。`npm run dev` でローカル開発。

---

## 2. ディレクトリ構成

```
/（リポジトリのルート＝Viteプロジェクトのルート）
├─ index.html
├─ vite.config.ts          # base: '/budget-tracker/'（Pages用。リポジトリ名と一致させる）
├─ package.json
├─ schema_supabase.sql     # DB定義（テーブル/RLS/索引）。Supabaseに適用済み
├─ .env.example            # ローカル用の雛形。.env は .gitignore で除外
├─ .github/workflows/deploy.yml
└─ src/
   ├─ main.ts
   ├─ App.svelte           # タブ構成・認証ゲート・初回シード・入力モーダルの制御
   ├─ app.css              # デザイントークン＋全コンポーネントのスタイル
   ├─ vite-env.d.ts
   ├─ lib/
   │  ├─ supabase.ts       # Supabaseクライアント（鍵はフォールバックで埋め込み済み。§7参照）
   │  ├─ types.ts          # DB型定義 + DIVISION_LABELS
   │  ├─ month.ts          # 予算月の計算（25日始まり）/ yen / ymd 等
   │  ├─ session.ts        # 認証セッションの store
   │  ├─ seed.ts           # 初回サインイン時の初期データ投入（口座・カテゴリ）
   │  └─ db.ts             # 全テーブルの取得・CRUDヘルパー（ここに集約）
   └─ components/
      ├─ Auth.svelte
      ├─ Home.svelte
      ├─ Transactions.svelte
      ├─ AddTransaction.svelte   # 追加・編集・削除の共通モーダル
      ├─ Analysis.svelte
      ├─ SpecialExpenses.svelte
      └─ Settings.svelte
```

---

## 3. データモデル（Supabase / Postgres）

詳細は `schema_supabase.sql`。テーブルは以下の7つ。**全テーブルに `user_id` と RLS（本人のみアクセス）が設定済み。**

- **accounts**（口座）: name, type(cash/bank/credit/emoney), opening_balance(整数・円), color, sort_order, archived
- **categories**（カテゴリ）: name, division(会計区分), parent_id, color, icon, sort_order, archived
- **transactions**（取引）: date, amount(整数・円・正の値), type(expense/income/transfer), category_id, account_id, to_account_id(振替先), person, memo, source(manual/recurring/csv/ocr), needs_review
- **recurring_rules**（定期）: name, amount, type, category_id, account_id, cycle(monthly/weekly), day_of_month, weekday, start_date, end_date, active, memo
- **budgets**（予算）: category_id, period_month('YYYY-MM'), amount。`unique(user_id, category_id, period_month)`
- **special_expenses**（特別費）: name, year, planned_month(1-12), budget_amount, actual_amount(null=予定), is_reserved(積立対象か), transaction_id
- **settings**（設定・1ユーザー1行）: month_start_day(既定25), currency('JPY')

### 会計区分（division）
`income`（収入）/ `tax`（税金・社保）/ `saving`（貯蓄）/ `fixed`（固定費）/ `variable`（変動費）

---

## 4. 重要な設計判断・規約（必ず守る）

- **金額は整数（円）** で保持・計算する。小数を使わない。
- **enum は文字列 + CHECK制約**（DB側）／TypeScript の union 型（アプリ側）で表現。
- **予算月は「25日始まり」**。`src/lib/month.ts` の `MONTH_START_DAY = 25` が基準。
  - 6月の予算月 = 6/25〜7/24。ある日付の予算月は `budgetMonthOf(date)`、範囲は `budgetMonthRange(year, month)` で取得。
  - ⚠️ 現状 `MONTH_START_DAY` は定数。`settings.month_start_day` はDBにあるが**アプリはまだ読んでいない**（未実装。§5参照）。
- **貯蓄は「先取り」として取引で記録**する（division=saving のカテゴリへの支出扱い）。専用テーブルは作らない。
- **人タグ**は transactions.person に文字列で持つ（'ゆうき' / 'えみ' / null）。給料・貯金・おこづかいの区別に使用。
- **振替**は type='transfer' で account_id(移動元)＋to_account_id(移動先)。※入力UIは未実装（§5）。
- **データ操作は必ず `src/lib/db.ts` のヘルパー経由**で行う（直接 supabase を叩かず、ここに追加する）。
- **将来のSwiftData移行を楽にする**: IDはUUID文字列、日付はISO文字列、金額は整数、リレーションはID参照、ロジックはUIから分離、データはJSONで丸ごと出せる状態を保つ。

---

## 5. 完了していること（実装済み機能）

- **認証**（Auth.svelte）: メール＋パスワードのサインイン／サインアップ。RLSで本人のデータのみ。
- **初回シード**（seed.ts）: 初サインイン時、カテゴリが空なら口座（現金/銀行/クレカ）と Excel由来のカテゴリ一式を自動投入。
- **タブナビ**（App.svelte）: ホーム / 取引 / 分析 / 特別費 / 設定 の5タブ。
- **ホーム**（Home.svelte）: 今月（予算月）の収入・支出・収支、予算の進捗バー、最近の取引。
- **取引**（Transactions.svelte）: 予算月の切り替え、種別/カテゴリ/人での絞り込み、日付ごとグループ表示、行タップで編集。
- **入力／編集／削除**（AddTransaction.svelte）: 支出/収入、金額、カテゴリ、口座、人、日付、メモ。
- **分析**（Analysis.svelte）: カテゴリ構成ドーナツ、固定費vs変動費、直近6ヶ月の支出推移、曜日別支出。
- **特別費**（SpecialExpenses.svelte）: 年切り替え、年間合計と毎月の積立目安（=年間/12）の自動計算、月別一覧、追加・編集・削除。
- **設定**（Settings.svelte）: カテゴリ管理（会計区分別）、口座管理、予算（カテゴリ×当月）、定期（追加・編集・削除＋「今月分の定期を計上」ボタン）。

---

## 6. 未完了・残作業（優先度の目安つき）

### 高（実用性に直結）
1. **CSV取込**: 銀行/カードの明細CSVを取り込み、`needs_review=true` 付きで transactions に登録。カードごとにフォーマットが異なるため、パーサーを種類別に用意。レビュー画面も必要。
2. **振替の入力UI**: データ構造（type='transfer', to_account_id）は対応済みだが、AddTransaction に振替モードが無い。種別トグルに「振替」を追加し、移動元/移動先口座を選べるようにする。
3. **月開始日を設定から読む**: 現在 `MONTH_START_DAY` 定数(25)。`settings.month_start_day` を読み込み、設定画面で変更可能にする。`month.ts` の各関数を「動的なstartDay」を受け取る形に拡張する必要がある（影響範囲が広いので慎重に）。

### 中（機能拡充）
4. **年間収支ビュー**: 会計区分 × 12ヶ月のマトリクス（Excelの収支表に相当）。現状は分析タブに直近6ヶ月の推移のみ。区分別の年間合計を一望できる画面を追加。
5. **レシートOCR**: 画像から金額・店名・日付を抽出して下書き登録。ブラウザなら Tesseract.js、精度重視ならサーバー側処理。難所なので後回し可。
6. **PWA化**: manifest と service worker を追加し、ホーム画面アイコン＆オフライン閲覧/入力（オンライン復帰時に同期）に対応。現状は通常のWebサイト（オンライン前提）。
7. **データのエクスポート/バックアップ**: 全データを JSON で書き出す機能（将来のSwiftData移行の布石にもなる）。
8. **定期の週次対応**: スキーマは cycle='weekly'/weekday を持つが、入力フォームは毎月のみ。週次UIと計上ロジックを追加。

### 低（任意・運用）
9. **セキュリティ強化（要確認）**: Supabase の Authentication で「新規サインアップ」をオフにすると、第三者がアカウントを作れなくなる（オーナーのログインは作成済み）。未対応なら実施推奨。
10. **将来のApple移行**: SwiftUI + SwiftData + CloudKit + Apple Watch への移植（別フェーズ）。本リポジトリの設計規約（§4）を守っていれば移行が楽になる。

---

## 7. 既知の注意点・落とし穴

- **`.env` はリポジトリに含めない**（.gitignore 済み）。Supabase の URL と publishable key は `src/lib/supabase.ts` に**フォールバックとしてハードコード**してあるため、`.env` が無くてもビルド・動作する。publishable key は公開前提の鍵で、データは RLS で保護される。
- **ビルド時に a11y 警告**（モーダル背景やタップ可能な li への click ハンドラ）が出るが、ビルドは成功する。動作に影響なし。気になる場合は keyboard ハンドラ追加で解消可。
- **定期の重複計上防止はヒューリスティック**（同一カテゴリ・金額・日付・source='recurring' の存在で判定）。厳密にしたい場合は transactions に recurring_rule_id 列を足す（スキーマ変更が必要）。
- **GitHub Pages の base path** は `/budget-tracker/`（vite.config.ts の `repo`）。リポジトリ名を変えたらここも変更。
- Supabase 無料枠は長期未使用でプロジェクトが一時停止することがある（日常利用なら問題なし）。

---

## 8. ローカル開発

```bash
npm install
cp .env.example .env     # 任意。URL/keyを入れる（無くてもフォールバックで動く）
npm run dev              # http://localhost:5173
npm run dev -- --host    # 同一Wi-FiのiPhoneからも開ける
npm run build            # 本番ビルド確認
```

---

## 9. デプロイ手順（iPhoneだけで完結）

このプロジェクトは **Claude Code on the web（クラウド実行）** で更新する運用。PCは不要。

1. Claude（アプリ/web）の Code で budget-tracker リポジトリに対しタスクを投げる（変更を実装させる）
2. Claude Code がクラウドVMでコードを書き、**ブランチを push して PR を作成**
3. GitHub（iPhoneでも可）で、その **PR を `main` にマージ**
4. `main` への push で `.github/workflows/deploy.yml` が走り、GitHub Pages へ自動デプロイ
5. `https://lorecajp.github.io/budget-tracker/` を再読み込み

※ GitHub Pages の Settings → Pages → Source は「GitHub Actions」に設定済み。
※ デプロイは **`main` への push でのみ** 発火する。ブランチのままでは公開されない。

---

## 10. 次にやると良いこと（推奨順）

1. 振替の入力UI（小さめ・効果大）
2. 年間収支ビュー（Excel収支表の代替）
3. 月開始日を設定から読めるようにする
4. CSV取込（使っているカード/銀行から順に）
5. PWA化 → レシートOCR

実装は必ず §4 の規約に従い、データ操作は `src/lib/db.ts` に集約すること。
