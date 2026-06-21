# 家計簿（Web版・Svelte + Supabase + GitHub Pages）

MacでもiPhoneでも使える家計簿アプリ。手入力でこの月の収支を記録・表示する最小版（フェーズ2の出発点）。

## このリポジトリにあるもの
- Svelte 5 + Vite + TypeScript のプロジェクト一式
- Supabase 接続（認証つき）
- ホーム画面（今月の収支・最近の取引、25日始まりの月計算）
- 入力フォーム（支出/収入・カテゴリ・口座・人・日付・メモ）
- GitHub Pages への自動デプロイ設定（.github/workflows/deploy.yml）

## セットアップ（最初の一度だけ）

### 1. Supabase 側
1. supabase.com でプロジェクトを作成
2. SQL Editor を開き、`schema_supabase.sql` の中身を貼り付けて実行（テーブル・RLS・索引が作られる）
3. 「設定 > API」から Project URL と anon public key を控える
4. 初期データを入れる：Table Editor で accounts に1件（例：現金）、categories に数件（例：食費=variable、給料=income）を追加。
   - もしくは後でアプリの設定画面（今後実装）から追加

### 2. ローカル
```bash
npm install
cp .env.example .env      # .env を編集し、URL と anon key を貼る
npm run dev               # http://localhost:5173
```
iPhoneでも確認したい場合：`npm run dev -- --host` で起動し、表示される
ネットワークURL（http://192.168.x.x:5173）を同じWi-FiのiPhoneで開く。

### 3. GitHub Pages へ公開
1. このコードを GitHub リポジトリに push（ブランチ main）
2. リポジトリの Settings > Secrets and variables > Actions に登録：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Settings > Pages > Build and deployment の Source を「GitHub Actions」に設定
4. `vite.config.ts` の `repo` 変数を、実際のリポジトリ名に合わせる
5. push すると Actions が自動でビルド＆公開。URL は `https://<ユーザー名>.github.io/<repo>/`

## メモ
- 金額は整数（円）で保持。
- 月の開始日は `src/lib/month.ts` の `MONTH_START_DAY`（現在25）。将来は設定テーブルから読む。
- anon key はフロントに出てよい公開鍵。データは RLS（本人のみ）で保護される。
