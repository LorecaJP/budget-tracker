# yutori（家計簿アプリ）引き継ぎ書（CLAUDE.md）

このファイルは、家計簿Webアプリ開発を Claude Code が引き継ぐための文脈・規約・残作業をまとめたもの。
**このファイルをリポジトリのルートに `CLAUDE.md` として置くと、以後の Claude Code セッションが自動で読み込む。**

> ## 🟢 運用ルール（最重要・必ず守る）
> **このファイルは常に最新に保つこと。** プロジェクトに変更を加えたら（機能の追加/変更、規約の更新、ディレクトリ構成の変化、ハマりどころの発見、残作業の消化など）、**同じ作業（同じPR）の中で CLAUDE.md も必ず更新する**。「あとで」にしない。オーナーから個別指示が無くても、変更内容に合わせて自分の判断で更新する。

---

## 0. これは何か（すぐ作業を始めるための要約）

- 個人専用の家計簿Webアプリ。**アプリ名は「yutori（ゆとり）」**（PWA表示名・タイトル・トップバー/ログインのブランド表記）。現行のExcel家計簿を置き換えるのが目的。
- **アイコン/ブランド**: クリーム地＋セージグリーン＋ブラウンの“やわらかクレイ調”（ノート＋円グラフ＋お家＋yutoriラベル）。`public/` の `pwa-192/512`・`pwa-maskable-512`・`apple-touch-icon`・`favicon.svg`（PNG埋め込み）。テーマ色 `#7E9466`／背景（スプラッシュ）`#F7ECDA`（`index.html`・`vite.config.ts`）。差し替えは元PNGの黒フチ除去→各サイズ書き出し（手順は `scratchpad` の `process_icon.py` 方式）。
- 利用者は主にオーナー（ゆうき）。Mac/iPhoneのブラウザから使い、データは Supabase で同期。**えみも自分のログインを持てる**（世帯共有・§5末「世帯共有」。えみは扶養トップのシンプル表示で閲覧＋入力可）。
- すでに **本番稼働中**。基本機能＋給与/賞与PDF取込＋PWAまで実装済み。残りは §7「未完了」。
- 将来的には Apple（SwiftUI）ネイティブ＋Apple Watch へ移行する構想があるため、**データモデルは移植しやすい形を保つ**こと（§4）。

### リンク／場所
- GitHub リポジトリ: `lorecajp/budget-tracker`（GitHub Pages で公開）
- 公開URL: `https://lorecajp.github.io/budget-tracker/`（PWA: ホーム画面に追加可）
- Supabase Project URL: `https://hmmgvqoemblxqqivspvl.supabase.co`
- DBスキーマ定義: リポジトリ内 `schema_supabase.sql`
- 給与スキャンOCR: Azure Document Intelligence（Supabase Edge Function `payslip-ocr` 経由。§6）

---

## 1. 技術スタック

- フロント: **Svelte 5（runes: `$state` / `$derived` / `$effect` / `$props`）** + **Vite** + **TypeScript**
- バックエンド: **Supabase**（PostgreSQL + Auth + RLS + Edge Functions）。クライアントは `@supabase/supabase-js` v2。
- ホスティング: **GitHub Pages**（`.github/workflows/deploy.yml` の GitHub Actions でビルド＆デプロイ）
- PWA: **`vite-plugin-pwa`**（Workbox。manifest + Service Worker を自動生成。`registerType: 'autoUpdate'`）
- PDF処理: **`pdfjs-dist`（legacy ビルド）**。給与明細PDFのテキスト抽出・スキャンの画像化に使用（§6・§8の注意点に注意）。
- スキャンOCR: **Azure Document Intelligence（prebuilt-layout）** を Supabase Edge Function `payslip-ocr` 経由で呼ぶ。
- ビルド: `npm run build`（= `vite build`）。型チェック: `npm run check`。`npm run dev` でローカル開発。

---

## 2. ディレクトリ構成

```
/（リポジトリのルート＝Viteプロジェクトのルート）
├─ index.html              # PWA/iOS用メタ（apple-touch-icon, theme-color 等）あり
├─ vite.config.ts          # base: '/budget-tracker/' + VitePWA 設定
├─ package.json
├─ schema_supabase.sql     # DB定義（テーブル/RLS/索引）。Supabaseに適用済み
├─ .env.example            # ローカル用の雛形。.env は .gitignore で除外
├─ .github/workflows/deploy.yml
├─ public/                 # favicon.svg, icons.svg, PWAアイコン(pwa-*.png, apple-touch-icon.png, maskable)
├─ supabase/
│  └─ functions/payslip-ocr/   # Azure OCR を呼ぶ Edge Function（Deno）。index.ts + README.md
└─ src/
   ├─ main.ts
   ├─ App.svelte           # タブ構成（6タブ）・認証ゲート・起動時に設定読込→シード→描画。分析/年間/楽天は「ふりかえり」(Reports)、支払い/特別費は「そなえ」(Prepare)にセグメントで集約
   ├─ app.css              # デザイントークン＋全コンポーネントのスタイル（iOS調＝グループドカード＋Liquid Glass風）
   ├─ vite-env.d.ts
   ├─ lib/
   │  ├─ supabase.ts       # Supabaseクライアント（鍵はフォールバックで埋め込み済み。§8）
   │  ├─ types.ts          # DB型定義 + DIVISION_LABELS
   │  ├─ month.ts          # 予算月の計算（25日始まり・動的startDay）/ yen / ymd 等
   │  ├─ businessday.ts    # 日本の祝日（2026-2027直書き）＋「引落日が休日なら翌営業日」/ 毎月の次回引落日
   │  ├─ session.ts        # 認証セッションの store
   │  ├─ seed.ts           # 初回サインイン時の初期データ投入（口座・カテゴリ）
   │  ├─ db.ts             # 全テーブルの取得・CRUDヘルパー（ここに集約）。設定の get/save も
   │  ├─ payslip/          # 給与・賞与PDF取込（§6）
   │  │  ├─ types.ts       #   ParsedPayslip 型（kind: salary/bonus 等）
   │  │  ├─ extract.ts     #   pdf.js でテキスト抽出 / 全ページ行復元(extractPdfRows) / 画像化（Safari対応は §8）
   │  │  ├─ parse.ts       #   テキストPDF（えみ様式）パーサ
   │  │  ├─ parseAzure.ts  #   Azure analyzeResult のパーサ（ゆうき給料・賞与）
   │  │  └─ ocr.ts         #   Edge Function payslip-ocr 呼び出し
   │  └─ rakuten/
   │     └─ parse.ts       #   楽天カード請求明細PDFのパーサ＋店名→カード利用カテゴリ自動判定（§6末）
   └─ components/
      ├─ Auth.svelte
      ├─ TxIcon.svelte          # 取引の種別/会計区分→色、カテゴリ名→アイコンの色つき丸（食費=食器/電気=雷/水道=雫/家賃=家/携帯=スマホ/保険=盾/ジム=運動/交通=バス/おこづかい=財布/交際=人/日用品=袋/貯金=ブタ/税=レシート 等。Home/Transactions で共用）
      ├─ Home.svelte            # 「今月まるごと」ダッシュボード＝MonthlyBreakdown を表示＋貯金の目標カード
      ├─ Transactions.svelte    # 「給与PDFを取り込む」ボタンあり。行頭に TxIcon。絞り込みに口座フィルタ＋口座別の当月支出サマリ
      ├─ AddTransaction.svelte  # 追加・編集・削除の共通モーダル（支出/収入/振替）
      ├─ Reports.svelte         # 「ふりかえり」タブ。分析/年間/楽天をセグメント(.seg)で束ねる薄い親（選択は localStorage 'reports_sub'）
      ├─ Prepare.svelte         # 「そなえ」タブ。支払い/特別費をセグメントで束ねる薄い親（選択は localStorage 'prepare_sub'）
      ├─ Analysis.svelte        # 「ふりかえり」内
      ├─ Ledger.svelte          # 「ふりかえり」内の「年間」。YearSummary を表示するだけの薄い親（月次はホームへ移動）
      ├─ MonthlyBreakdown.svelte# 今月の費目別 実績/予定（予算）＝**ホームの本体**。ヒーローは「見込みの残り（実績優先・無ければ予定）」＝先の月を選べば収入・支出とも予定で試算になる
      ├─ YearSummary.svelte     # 年間：費目×12予算月。区分行タップで開閉。各セルは実績優先・無ければ予定(薄字)
      ├─ SpecialExpenses.svelte # 「そなえ」内
      ├─ UpcomingPayments.svelte# 「そなえ」内の「支払い」。引落の事前把握（確定額＋引落日＋引落口座）→口座ごとに用意する額
      ├─ FuyouTracker.svelte    # 扶養トラッカー（えみ）。暦年でえみ給料を集計し上限までの残り金額/時間。タブ「扶養」（独立タブのまま）。確定＋見込み(ShiftPlanner)で「あと働ける」を算出
      ├─ ShiftPlanner.svelte    # 扶養タブ内。就労月ごとの見込み(=Σ時間×時給・手動上書き可)サマリ＋「カレンダーで入力」ボタン。支給は就労月の翌月末＝その年にカウント。将来のGカレンダー連携(方式2)もこの shifts を使う
      ├─ ShiftCalendar.svelte   # シフト入力の月カレンダー（ボトムシート）。日付タップで1日1シフトを登録/編集/削除。**よく使うシフトの1タップ登録**（13:00〜20:30 / 9:30〜17:00 のクイックボタン＝`quick()`が開始/終了をセットして即保存）。休憩は「労働(開始〜終了)が6時間超のとき自動90分／6時間ちょうど以下は休憩なし」＝breakFor()で算出（手入力なし）。1画面に収まる高さ＋背景スクロール固定（body overflow:hidden ＋ .sheet overscroll-behavior:contain）。grid は minmax(0,1fr)＋セルは固定高さ（aspect-ratio はこの環境の grid で崩れる）。空セルは淡色で枠を均一に
      ├─ PayslipImport.svelte   # 給与・賞与PDF取込のモーダル（レビュー画面）
      ├─ RakutenCard.svelte     # 「楽天」タブ。請求月チップ＋**節約ウォッチ**（減らしたい店の月別合計/前月比/年換算/目標）＋カテゴリ別内訳（店ドリル/分類変更）＋年間サマリ
      ├─ RakutenImport.svelte   # 楽天カード請求明細PDF取込モーダル（カテゴリ別サマリ→請求月単位で登録）
      └─ Settings.svelte        # カテゴリ/口座/予算/定期 + 月の開始日 + 扶養トラッカー設定（時給/上限）+ 貯金の目標 + 口座への配分（予算は『12ヶ月へ一括』可）
```

---

## 3. データモデル（Supabase / Postgres）

詳細は `schema_supabase.sql`。**全テーブルに `user_id` と RLS が設定済み。** 既定は「本人のみアクセス」だが、**世帯共有（えみ専用ログイン）を有効化すると「同じ世帯なら閲覧/編集可」に置き換わる**（`household_members` ＋ `in_my_household()`。§5末「世帯共有」/ `supabase/household_share.sql`）。

- **accounts**（口座）: name, type(cash/bank/credit/emoney), opening_balance(整数・円), color, sort_order, archived, monthly_alloc(毎月この口座へ振り分ける計画額＝配分プラン。**後から追加した列**。`alter table accounts add column if not exists monthly_alloc integer;`。未追加でも未設定として動作)
- **categories**（カテゴリ）: name, division(会計区分), parent_id, color, icon, sort_order, archived, goal_amount(貯金の目標額＝貯蓄カテゴリ用。**後から追加した列**。`alter table categories add column if not exists goal_amount integer;`。未追加でも目標未設定として動作)
- **transactions**（取引）: date, amount(整数・円・正の値), type(expense/income/transfer), category_id, account_id, to_account_id(振替先), person, memo, source(manual/recurring/csv/ocr), needs_review
- **recurring_rules**（定期）: name, amount, type, category_id, account_id, cycle(monthly/weekly), day_of_month, weekday, start_date, end_date, active, memo
- **budgets**（予算）: category_id, period_month('YYYY-MM'), amount。`unique(user_id, category_id, period_month)`。**予算＝その月の「予定額」として「収支」タブ（月次・年間）に表示し、実績が入ると置き換える**（`db.ts` の `listBudgetsForYear`/`setBudgetAllMonths`＝年12ヶ月へ一括）。
- **special_expenses**（特別費）: name, year, planned_month(1-12), budget_amount, actual_amount(null=予定), is_reserved(積立対象か), transaction_id
- **settings**（設定・1行）: month_start_day(既定25), currency('JPY'), emi_hourly_wage(既定1180), emi_year_cap(既定1030000=扶養トラッカーの年間上限。103万円＝夫の会社の扶養手当の条件)。**アプリで使用中**（§4）。emi_* は後から追加した列（既存DBは `alter table settings add column if not exists ...`。未追加でも既定値で動作）。**世帯共有時は世帯で1行＝owner の行を共有**（`getSettings`/`saveSettings`/`saveFuyouConfig` は `limit(1)` で単一行を読み、更新は既存行の `user_id` を対象にする＝えみが変えても owner 行を更新し2行に増えない）。
- **payslip_details**（給与明細の追加項目・扶養トラッカー用）: person, pay_date, gross, taxable(課税支給額), commute(通勤手当), work_minutes(総労働時間・分), transaction_id。給与取込時に保存（`unique(user_id, person, pay_date)`＝再取込で更新）。**後から追加した表**。未作成でもアプリは動く（扶養タブは総支給のみ表示・取込時の保存は黙ってスキップ＝`listPayslipDetails`/`upsertPayslipDetail` がフォールバック）。
- **rakuten_transactions**（楽天カード明細・**家計簿本体とは別管理**の分析用）: use_date, merchant(利用店名), amount(利用金額), person(本人/家族), category(カード利用カテゴリ・自動判定&編集可), statement_month('YYYY-MM'＝請求月)。「楽天」タブで使用。**後から追加した表**。未作成でも空表示で動く（`listRakutenTx`）。請求月単位で置き換え（`replaceRakutenStatement`＝再取込で重複しない・手直し済みの店カテゴリは引き継ぐ）。固定費の二重計上を避けるため本体 transactions には入れない。
- **scheduled_payments**（支払い予定・引落の事前把握）: name, amount(確定額/予定額), due_date(単発の引落日・null可), due_day(1-28＝毎月くりかえしの引落日), account_id(引落口座), category_id, status(planned/confirmed/paid), memo。「支払い」タブで使用。**後から追加した表**。未作成でも動く（取得は空配列フォールバック＝`listScheduledPayments`。追加時のみ要作成）。`due_day` があれば毎月くりかえし（`businessday.ts` の `nextMonthlyDue` で次回引落日を休日補正して表示）、無ければ `due_date` の単発。既存表には `add column if not exists due_day` ＋ `due_date drop not null`。
- **household_members**（世帯メンバー・**世帯共有/えみ専用ログイン用**・後から追加した表）: user_id(PK), household_id, person('ゆうき'/'えみ'＝表示の出し分け用), role('owner'/'member')。**ゆうき/えみ が別ログインで同じ家計データを共有**するための表。RLS は `my_household_id()`/`in_my_household()`（**security definer**で自己参照の無限再帰を回避）を使い、各データ表のポリシーを「本人のみ」→「同じ世帯なら閲覧/編集可」に置換する。**未作成（移行前）でもアプリは動く**＝`getMyMembership` が null を返し、単一ユーザー・全画面表示で従来どおり。作成・連携・ロールバックは `supabase/household_share.sql`（§5末）。

- **shifts**（えみの予定シフト・**扶養計画/見込み用**・後から追加した表）: work_date(就労日), start_min/end_min(0時からの分), break_min(休憩分), person('えみ'), memo。**見込み課税収入＝Σ(時間)×時給**の元。**将来の Google カレンダー連携（方式2 ワンタップ同期）でもこの shifts を使う**。RLS は世帯共有。未作成でも空配列フォールバック。適用は `supabase/shifts.sql`。
- **fuyou_overrides**（見込み額の手動上書き・後から追加した表）: person, work_month('YYYY-MM'＝就労月), amount(見込み課税額)。シフトからの自動見込みを手で上書きする（残業・早上がりのズレ調整）。`unique(user_id, person, work_month)`。`setFuyouOverride` は世帯内の既存行を更新（0/null で削除＝自動に戻す）。未作成でも動く。

### 会計区分（division）
`income`（収入）/ `tax`（税金・社保）/ `saving`（貯蓄）/ `fixed`（固定費）/ `variable`（変動費）

---

## 4. 重要な設計判断・規約（必ず守る）

- **金額は整数（円）** で保持・計算する。小数を使わない。
- **enum は文字列 + CHECK制約**（DB側）／TypeScript の union 型（アプリ側）で表現。
- **予算月は「25日始まり（既定）」**。`src/lib/month.ts` 参照。
  - 「M月の予算月」= M/25〜翌月24日。ある日付の予算月は `budgetMonthOf(date)`、範囲は `budgetMonthRange(year, month)`。
  - **開始日は動的**: `MONTH_START_DAY` 定数は廃止。`getMonthStartDay()` / `setMonthStartDay()` を使う。App 起動時に `settings.month_start_day` を読んで `setMonthStartDay` する。`budgetMonthOf/budgetMonthRange` は `startDay` を任意引数で受け（既定＝現在値）。設定画面で変更すると保存＋`location.reload()` で全画面再集計。
- **貯蓄は「先取り」として取引で記録**する（division=saving のカテゴリへの支出扱い）。専用テーブルは作らない。
- **人タグ**は transactions.person に文字列で持つ（'ゆうき' / 'えみ' / null）。給料・貯金・おこづかいの区別に使用。
- **振替**は type='transfer' で account_id(移動元)＋to_account_id(移動先)。**入力UIあり**（AddTransaction の種別トグル「振替」）。集計（収支/分析/年間）では振替を除外する。
- **データ操作は必ず `src/lib/db.ts` のヘルパー経由**で行う（直接 supabase を叩かず、ここに追加する）。
- **将来のSwiftData移行を楽にする**: IDはUUID文字列、日付はISO文字列、金額は整数、リレーションはID参照、ロジックはUIから分離、データはJSONで丸ごと出せる状態を保つ。
- **給与/賞与の計上月**（§6）: 給料=支給日の予算月（25日払いが休日で22〜24日に前倒しされたら25日に補正）。賞与=その月の25日に補正（同月の25日給料と同じ予算月にする）。いずれもレビュー画面で手修正可。

---

## 5. 完了していること（実装済み機能）

- **認証**（Auth.svelte）: メール＋パスワード。RLSで本人のデータのみ（**世帯共有を有効化すると同じ世帯で共有**＝§5末「世帯共有」）。
- **初回シード**（seed.ts）: 初サインイン時、カテゴリが空なら口座（現金/銀行/クレカ）と Excel由来のカテゴリ一式（ゆうき給料/えみ給料/ボーナス/各税・保険/各固定費/各変動費 等）を自動投入。**世帯共有時、えみ（member）ではシードしない**（世帯データと重複するため。`App.boot` が `membership.role` で判定）。
- **タブナビ**（App.svelte）: **6タブ**＝ホーム / 取引 / **ふりかえり** / **そなえ** / **扶養** / 設定（id: home/tx/reports/prepare/fuyou/settings）。9→6に整理済み：**ふりかえり**(Reports)＝[分析｜年間｜楽天]、**そなえ**(Prepare)＝[支払い｜特別費] をセグメント切替で束ねる（各画面はそのまま再利用、サブ選択は localStorage 保持）。**扶養は独立タブのまま**。月次内訳はホームに集約済み。起動時に設定読込→（membership判定）→シード→描画をゲート。**ログイン中のユーザーで表示タブを出し分け**（`getMyMembership` の `person`・`tabIds` を `$derived`）：**えみ＝[扶養(トップ)/ホーム/取引/設定]** のシンプル表示（ふりかえり・そなえを隠す＝**楽天も非表示**）、**ゆうき＝6タブ全部**。**未連携（person判定不可）は全タブ＝従来どおり**（移行前でも無改修で動く）。世帯共有の有効化手順は§5末。
- **ホーム＝今月まるごとダッシュボード**（Home.svelte）: 予算月を切替えながら、**今月の残り（実績）＋「予定どおりなら」の予定残り**、**収入の内訳**、**支出の内訳（区分×費目、実績/予定）**、**特別費（その月の臨時支出・special_expenses から planned_month 一致分）** を1画面で表示（＝MonthlyBreakdown をそのまま表示）。その下に**貯金の目標カード（達成率バー）**。特別費も見込み支出・見込み残りに含める（実績優先・無ければ予定）。Excelの月シートの代替で、イレギュラーな支出が入ると実績の残りが予定残りから下がるのが一目でわかる。**日次の手入力グリッドは作らない**（オーナーは使わないため）。
- **取引**（Transactions.svelte）: 予算月切替、絞り込み（種別/カテゴリ/人/**口座**）、日付グループ、行タップ編集、**給与PDF取込ボタン**。振替は「口座A→口座B」表示・日次集計から除外。各行のサブに口座名も表示。**口座フィルタ選択中はその口座の当月支出合計をサマリ表示**（楽天カード等の「分離管理」＝③に対応。`listTransactions` の `accountId` フィルタ）。
- **入力／編集／削除**（AddTransaction.svelte）: 支出/収入/**振替**。振替は移動元/移動先口座を選択。
- **分析**（Analysis.svelte）: カテゴリ構成ドーナツ、固定費vs変動費、直近6ヶ月推移、曜日別支出（すべて type='expense' 集計＝振替は自動除外）。
- **予実ビュー（予算を『予定額』として実績で上書き）**: Excelの「各月シート」＋「収支表」の代替。**予算を予定額として使い、実績があれば実績・無ければ予定（薄字）で表示**（＝事前に予定を入れておき支出登録で置き換え）。**月次はホーム**（MonthlyBreakdown）、**年間は「ふりかえり」タブの「年間」**（YearSummary）に分かれている。
  - **月次（＝ホーム本体・MonthlyBreakdown.svelte）**: 予算月を切替、費目別に **実績／予定（予算）** を区分ごとのカードで表示。予定超過は赤＋進捗バー。ヒーローは **「見込みの残り」＝Σ(実績優先・無ければ予定)** で収入・支出とも算出（＋「確定(実績)」を併記）。**先の月を選べば収入も支出も予定で埋まり3〜6ヶ月先の試算になる**（収入の予定額が肝）。
  - **年間（YearSummary.svelte / 「ふりかえり」タブ内・Ledgerが薄く包む）**: **費目×12予算月**のマトリクス。区分行をタップで開閉（既定で固定費・変動費を開く）。各セルは実績優先・無ければ予定(薄字`.est`)。区分小計・支出計・収支も実績＋予定で算出。1クエリ取得＋文字列境界比較で月振り分け（TZ非依存）。
  - 予定額（予算）の入力は2か所：**①ホームで費目をタップ→その月の予定額を即編集**（`setBudget`/`setBudgetAllMonths`。12ヶ月一括チェックつき）。**②設定タブの「予算」**（月を◀▶で切替、対象は **収入＋固定費＋変動費** を区分ごとに表示）。**`12ヶ月へ一括`チェック（既定ON）で入れた額をその年の1〜12月へ一括反映**（給料・固定費向け。`setBudgetAllMonths`。0以下で削除）。チェックを外せばその月だけ（ボーナスや7月の水道など臨時の予測）。**収入に予定額を入れると先の月の収入見込みが出る＝試算が成立**。
- **特別費**（SpecialExpenses.svelte）: 年切替、年間合計と毎月の積立目安、月別一覧、追加/編集/削除。
- **支払い予定**（UpcomingPayments.svelte / タブ「支払い」）: 請求額が**確定してから引き落とされるまで**にキャッシュを用意するためのビュー。各支払いを **金額＋引落日＋引落口座** で登録。**毎月くりかえし（due_day）**と**1回だけ（due_date）**を選べ、くりかえしは**引落日が土日祝なら翌営業日**に補正して次回引落日を表示（`businessday.ts`、祝日は2026-2027直書き）。**口座ごとに「用意する額（合計）＋最短引落日」**を集計表示し、引落日順リストで「あと○日／○日超過」を表示。くりかえしは常に次回分を表示（状態管理なし）、単発は引き落とし後に「支払済」で合計から外す（`db.ts` の `listScheduledPayments`/`upsertScheduledPayment`/`setScheduledStatus`、`scheduled_payments` テーブル。未作成でも空表示で動く）。Excelの口座色分け（緑=ゆうちょ/青=SBI/赤=楽天/黄=現金）に対応した「どの口座から引き落ちるか」をここで管理。初期口座は汎用（現金/銀行/クレカ）なので、実口座（ゆうちょ/住信SBI/ゆうき楽天/えみ楽天）はSQLで追加して紐づけ。
- **貯金の目標＆進捗**: `categories.goal_amount`（貯蓄カテゴリの目標額）を設定でき、ホームの「貯金の目標」カードに **累計(=その貯蓄カテゴリへの全期間の支出)/目標＝達成率** をバー表示（`db.ts` の `setCategoryGoal`/`sumSavingByCategory`）。目標の設定は設定タブの「貯金の目標」カード。列未追加でも動作（目標未設定扱い）。Excel由来の目標例: 防衛費80万/特別費30万/ゆうき貯金12万/えみ貯金12万。
- **扶養トラッカー**（FuyouTracker.svelte / タブ「扶養」）: えみが夫の扶養を外れないよう、**暦年(1〜12月)・支給日ベース**で `category='えみ給料'` の収入を集計。**ヒーローカード**（数字/ITが苦手な妻向けにシンプル化）: **信号（緑〜79% / 黄80〜95% / 赤96%〜）＋メッセージ**（緑「まだまだ大丈夫」/ 黄「そろそろ気をつけてね」/ 赤「もうギリギリ」、超過時のみ「超えちゃった」）。その下に **「今年あと」「1ヶ月あたりあと」** × **[時間 / 金額]** を**固定サイズ62pxの4タイル**（Lucide: clock=時間=緑 / banknote=金額=青。折り返さず常に同サイズ）。進捗バー＋「○万円まで○%」。超過時はタイル0表示＋「上限を○超えています」。`1ヶ月あたり`＝今年の残りを残り月数で割った目安（今月が未払いなら含む）。明細（課税支給額・総支給・通勤手当・総労働時間・着地見込み）は**別カード**。月別（社保の月8.8万ライン警告つき）も表示。色トークンは `app.css` の `--fy-*`（ダーク対応）、スタイルは `.fy-*`。**上限判定は課税支給額（通勤手当を除く＝103万手当・税の正しい基準。`課税支給額＝総支給−通勤手当` で算出。明細の課税支給額は年内累計なので使わない）**で、**総支給（通勤手当込み）も併記**。さらに `payslip_details` から **通勤手当の合計・総労働時間の合計（週平均h／20時間接近で警告）** も蓄積表示。**年末調整還付（category=null）は報酬でないため集計対象外**。時給・年間上限は `settings.emi_hourly_wage/emi_year_cap`（設定タブで変更可、`db.ts` の `getFuyouConfig/saveFuyouConfig`。列未追加でも既定値で動作）。集計は暦年なので**予算月(25日始まり)とは別軸**。
  - **シフト・見込み（ShiftPlanner.svelte／扶養タブ内）**: えみが**シフト（就労日＋開始/終了/休憩）を入力**すると、**就労月ごとの見込み課税収入＝Σ時間×時給**を算出（`fuyou_overrides` で**手動上書き可**＝残業・早上がりの調整）。**支給は就労月の翌月末**なので、pay-month p の見込みは work-month(p-1) のシフトから出し、**実給与が入った月（received）は見込みを0**にして二重計上しない（`db.ts` の `listShifts/upsertShift/deleteShift/listFuyouOverrides/setFuyouOverride`）。FuyouTracker は **確定（課税）＋見込み** をヒーローの「あと働ける 円/時間」に反映（明細に「確定／見込み／合計」を併記）。これで**毎月10日のシフト提出時に「上限まであと何時間/円 働けるか」**が分かる。**未受給でも金額が分かっている給料（例：5月就労ぶんを6/30受給）を見込みで先に織り込める**。※Google カレンダー連携（方式2 ワンタップ同期：確定シフト→Gカレンダー→TimeTree）は次フェーズ（§7）。`shifts`/`fuyou_overrides` 未作成でも見込み0で動く（SQL: `supabase/shifts.sql`）。
  - **壁の整理（重要）**: ①**103万円**＝夫の会社の扶養手当（¥1万/月）の条件で最も低い壁→これが既定の管理ライン。②106万円＝社保の賃金要件だが**2026年10月に撤廃**。③123万円＝えみ本人の所得税（2025年改正で103→123万）。④130万円＝社保の被扶養者認定。**103万を守れば②③④も自動でクリア**。
  - **2026年10月の制度変更**: 社保の賃金要件(月8.8万)が撤廃され、51人以上の勤務先では「**週の所定労働時間20時間以上**」だけで社保加入＝金額では決まらなくなる。えみの勤務先(サーティーンストラット)は200〜400名で常に該当するため、以降は**週20時間未満かどうかが社保扶養の唯一の鍵**。手当(103万)とは別軸なので、上限到達だけでなく週20時間も意識する（UIにも注記済み）。
- **口座への配分（配分プラン）**: `accounts.monthly_alloc`（毎月どの口座へいくら振り分けるかの計画額）を設定でき、設定タブの「口座への配分」カードで口座ごとに入力＋**合計**を表示（手取りに合わせる目安。`db.ts` の `setAccountAlloc`）。Excel由来の例: ゆうちょ/SBI/ゆうき楽天/えみ楽天/現金などへ配分。列未追加でも動作（未設定扱い）。**②口座振り分け**に対応。
- **楽天カード分析**（RakutenCard.svelte / RakutenImport.svelte / タブ「楽天」）: 楽天カードの「ご利用代金請求明細書PDF」を取り込み、**何にいくら使ったか**を**カテゴリ別（＋店ドリルダウン）・請求月別・年間**で見る。**家計簿本体とは別管理**（`rakuten_transactions` テーブル。固定費の二重計上を避けるため transactions には入れない）。取込：`extractPdfRows`（pdf.js で全ページを位置から行復元）→ `rakuten/parse.ts`（明細パース＝支払方法の「N回」を除去してから利用金額を拾う／店名キーワードでカード利用カテゴリを自動判定。§8の行崩れ対策）→ レビュー→ **請求月単位で置き換え保存**（再取込で重複しない・手直し済みの店カテゴリは引き継ぐ）。タブでは請求月チップ＋カテゴリ別内訳（タップで店明細、店タップで分類変更＝`updateRakutenCategoryByMerchant`）＋年間サマリ（カテゴリ別 合計/月平均）。カテゴリは `RAKUTEN_CATEGORIES`（食・カフェ/娯楽・サブスク/レジャー・旅行/交通/買い物/通信・公共/健康・会費/チャージ・電子マネー/その他。**固定9カテゴリで、`RULES` とは独立に定義**）。実データ検証で2026年1〜6月の6請求月（1月¥223,226/2月¥187,379/3月¥318,031/4月¥220,423/5月¥265,094/6月¥257,195）が請求額と一致。**未作成でも空表示**（`alter`不要、要 `create table rakuten_transactions`）。
  - **自動分類ルール（`parse.ts` の `RULES`・`categorize`）**: 店名キーワードの**部分一致**で判定（上から順・最初に一致したものを採用）。明細は「楽天ＳＰ　」やPayPayの「ﾍﾟｲﾍﾟｲ*」が前置され、表記が半角ｶﾅ/全角まちまちなので**“店名そのもの”のキーワード**で判定する。**旧 `ﾍﾟｲﾍﾟｲ→チャージ` の一括判定は誤分類（例: 鬼酔/キズイがチャージ扱い）のため廃止**。特定店は総称ルールより前に置く（例: 自販機/Coke ON＝`ｺ-ｸｵﾝ`は`APPLE`より先、`ｲｵﾝｼﾈﾏ`は`ｲｵﾝ`より先、近鉄百貨店`ｷﾝﾃﾂﾋﾔﾂｶﾃﾝ`は`ｷﾝﾃﾂ`より先）。オーナー指定の特例: **アグヘアー(美容室)→健康・会費**、鬼酔(定食屋)→食・カフェ。店名が読めない「楽天ＳＰ　楽天ペイ加盟店」等は**その他**。ルールは6ヶ月の実データで検証済み（`scratchpad` の verify スクリプト）。新しい店が増えたら `RULES` にキーワードを足す。
  - **再取込での再分類（`replaceRakutenStatement(month, items, recategorize=false)`）**: 既定は手直し済みカテゴリを引き継ぐが、取込モーダルの**「自動分類でやり直す」チェック**（`recat`・選択は localStorage 保持）を入れると `recategorize=true` で**引き継ぎを無効化し最新ルールで全件上書き**する。**`RULES` を更新したら、このチェックを入れて各月を取り込み直すと反映される**（チェック無しの普通の再取込では旧カテゴリが残るので注意）。
  - **節約ウォッチ（RakutenCard.svelte）**: 「減らしたい店」をグループ（ラベル＋キーワード配列＋任意の月目標）で登録し、**選択中の請求月の合計・回数・前月比（減ると緑▼）・年換算・目標バー**を請求総額のすぐ下に大きく表示。既定は **コンビニ/スタバ/DMM**。設定は **localStorage（`rk_watch`）保持**（端末ごと。集計対象の `rakuten_transactions` は Supabase 同期）。「編集」でグループの追加/削除・キーワード・目標を変更でき、「既定に戻す」も可。マッチは `merchant.includes(keyword)`（部分一致）。**支出データには手を入れない**＝既存明細の見せ方を変えるだけの軽量機能。
- **設定**（Settings.svelte）: カテゴリ/口座/**予算（固定費・変動費。『12ヶ月へ一括』チェックで年内全月へ）**/定期の管理 ＋ **月の開始日**（settings.month_start_day を変更可）＋ **扶養トラッカー設定**（えみの時給・年間上限）＋ **貯金の目標**（貯蓄カテゴリの目標額）＋ **口座への配分**（配分プラン）。
- **給与・賞与PDF取込**（§6）: えみ=テキストPDF、ゆうき給料・賞与=スキャン+Azure OCR。
- **PWA**: ホーム画面に追加可（manifest/アイコン/Service Worker）。アプリシェルはオフラインでも起動（データ表示/入力はオンライン必須）。
- **世帯共有（えみ専用ログイン）**: ゆうき / えみ が**別々のログイン**を使いつつ、家計データは**世帯で1つを共有**する（えみも閲覧＋入力できる＝読み書き可）。既存データは ゆうき 所有のまま、RLS を「本人のみ」→「同じ世帯なら閲覧/編集可」へ置換するだけ（**列追加・データ移行なし**）。仕組みは `household_members` ＋ `in_my_household()`（§3）。アプリは `getMyMembership` で**ログイン中が誰かを判定**し、**えみは扶養トップのシンプル表示／ゆうきは全タブ**（§5タブナビ）。`settings` は世帯で1行（owner 行を共有）。
  - **有効化手順（オーナーが Supabase で実行・本番DB）**: `supabase/household_share.sql` 参照。①「1) 仕組み」「2) RLS 置換」を SQL Editor で実行（**いつでも安全**＝ゆうきの見え方は従来どおり）→ ②**えみがアプリで「アカウントを作る」→メール確認→サインイン**→ ③「3) 連携」の `YUUKI_EMAIL`/`EMI_EMAIL` を実メールに書き換えて実行（ゆうき=owner / えみ=member を同じ世帯に登録＋えみが連携前に自動投入した初期データを掃除）。**注意：えみは連携(③)まで入力しない**（③が初期データの重複を消すため）。元に戻すは同ファイル「9) ロールバック」。
  - **RLS の要点（落とし穴対策）**: `my_household_id()`/`in_my_household()` は **`security definer`＋`set search_path=public`**。`household_members` を参照するポリシーを通常権限で書くと**無限再帰エラー**になるため、definer 関数で RLS をバイパスして判定する。各表ポリシーは `using/with check = ( user_id = auth.uid() or in_my_household(user_id) )`（**自分の行 or 同じ世帯**。前段の `user_id = auth.uid()` で**未連携でも自分の行は必ず見える**＝移行直後やロールバック後の事故防止）。アプリ側は **`household_members` 未作成でも `getMyMembership` が null で従来動作**するため、アプリ変更を先にデプロイしてOK（SQL は後追いで安全）。

## 6. 給与・賞与PDF取込 ＆ Azure OCR（重要・実装済み）

取引タブ →「📄 給与PDFを取り込む」→ PayslipImport.svelte（モーダル）。**自動保存はしない。必ずレビュー画面で確認→登録。**

### フロー
1. PDF選択 → `lib/payslip/extract.ts`（pdf.js）でテキスト層の有無を判定。
2. **テキストあり**（えみ＝有限会社サーティーンストラット様式）: `parse.ts` で即パース → レビュー。
3. **テキストなし＝スキャン**（ゆうき給料/賞与＝ビズライフエージェント様式）: 「☁️クラウドOCRで読み取る」→ `extract.ts` の `renderPdfFirstPage` で画像化 → `ocr.ts` が Edge Function `payslip-ocr` を呼ぶ → Azure Document Intelligence（prebuilt-layout）→ `parseAzure.ts` で項目抽出 → レビュー。
4. 確定で **総支給＝収入1件**（カテゴリ: えみ給料/ゆうき給料/賞与は「ボーナス」）＋ **各控除＝tax区分の支出**（健康保険/厚生年金/雇用保険/住民税/所得税。同じ口座から）を登録。`source='ocr'`。重複（同日同額）警告・差引支給額の不一致警告あり。給料(salary)は併せて **`payslip_details`**（通勤手当・総労働時間。`parse.ts` が `通勤手当` と `総労働時間`(HH:MM→分) を抽出）も保存し、扶養トラッカーの蓄積に使う（レビュー画面で確認・手修正可）。
   - **再取込は置き換え（二重登録防止）**: 各取引の memo に識別マーカー `#ps:person:payDate:kind` を付け、保存前に `deleteOcrPayslipTx` で「同マーカー or 旧（マーカー無し）の同人・同日OCR取引」を削除してから入れ直す。これで同じ明細を再取込しても重複しない（旧データの掃除も兼ねる）。
   - **課税支給額は取り込まない**: 明細の「課税支給額」は**年内累計**（前月までを含む）なので合算すると過大になる。扶養タブでは **課税支給額＝総支給−通勤手当** で月次算出する（`parse.ts` の `taxable` は null 固定）。

### パーサのポイント（実データで検証済み）
- 控除の内訳は **Azureの表(tables)のセル**から取る（ラベルの真下＝行+1・同列）。本文(content)はラベルと値が離れるため誤対応する。小計（社会保険料計）・課税対象額・控除合計は内訳に含めない。
- 合計（総支給額/差引支給額）は本文から。差引支給額は表からも拾う（賞与は本文で値が隣接しない）。
- OCRがカンマを `.` と誤読することがある → `.` `,` 両方を桁区切りとして除去。
- 支給日の和暦: `令和N年` → 西暦 2018+N。賞与は `令和` 省略のことがあり、1〜2桁年は令和とみなす。
- 計上月の補正は §4 のルール（給料=25日前倒しsnap、賞与=同月25日snap）。元の支給日はメモに残す。
- **年末調整の還付（マイナス控除）対応（えみ様式・実データで検証済み）**: 12月分などで `控除合計` が**マイナス**（例: 年調過不足税額 `-5,230` ＝還付）になる。`parse.ts` の数値判定は符号（`- − ▲ △`）を許可し、マイナスの控除合計も拾う（旧 `/^[\d,，]+$/` だと拾えず還付が消え、差引支給額と不一致の誤警告が出ていた）。**マイナス控除は還付なので PayslipImport の `save()` で金額を正にして type=income（収入）として登録**する（控除＝支出のまま負数にすると `amount>0` 制約に反するため）。これで計算 net＝総支給−控除合計＝振込支給額となり警告も出ない。収入はカテゴリnullでも年間ビュー等で income 区分に集計される。

### Azure 構成（オーナーが用意済み）
- リソース: Azure **Document Intelligence**（F0 無料枠＝月500ページ）。
- Edge Function `supabase/functions/payslip-ocr/`（Deno）: 画像を受けて Azure を呼び `analyzeResult` を返す。**Azureキーはここ（サーバー側）だけが持つ**。JWT検証ありで本人のみ。
- シークレット（Supabase Edge Functions の Secrets）: `AZURE_DI_ENDPOINT` / `AZURE_DI_KEY`（任意: `AZURE_DI_MODEL`=prebuilt-layout, `AZURE_DI_API_VERSION`=2024-11-30）。手順は `supabase/functions/payslip-ocr/README.md`。

---

## 7. 未完了・残作業（優先度の目安つき）

### 高（実用性に直結）
1. **CSV取込**: 銀行/カードの明細CSVを取り込み、`needs_review=true` 付きで transactions に登録。カードごとにフォーマットが異なるためパーサーを種類別に。レビュー画面は PayslipImport の作りが参考になる。

### 中（機能拡充）
- **シフト→Googleカレンダー連携（方式2 ワンタップ同期・えみ／扶養の続き）**: ShiftPlanner の確定シフトを**ボタン一つで Google カレンダーへ登録**→TimeTree は「外部カレンダー表示」で自動反映（TimeTree側機能）。実装は **Google Identity Services のトークンクライアントで Calendar スコープを取得→Calendar API でイベント insert**（要・Google Cloud の OAuth クライアント＋同意画面にえみをテストユーザー登録。オーナーが一度設定）。`shifts` テーブルはこの用途も見据えて作成済み。代替の軽い方法＝「カレンダーに追加」リンク/.ics（方式1）や .ics 購読（方式3・反映が遅い）。オーナーは**方式2を選択済み**。
2. **汎用レシートOCR**: 給与明細OCRは実装済み（Azure）。店舗レシートからの金額・店名・日付抽出は未。Azure を流用するか Tesseract.js。
3. **完全オフライン入力＋同期**: 現状PWAは「インストール可＋アプリシェルのオフライン起動」まで。圏外で入力→オンライン復帰時に同期、は未実装（IndexedDBの保留キュー＋同期で大きめ）。
4. **データのエクスポート/バックアップ**: 全データを JSON で書き出す（SwiftData移行の布石）。
5. **定期の週次対応**: スキーマは cycle='weekly'/weekday を持つが入力フォームは毎月のみ。週次UIと計上ロジックを追加。

### 低（任意・運用）
6. **セキュリティ強化（要確認）**: Supabase の Authentication で「新規サインアップ」をオフにする（オーナーのログインは作成済み）。未対応なら推奨。
7. **将来のApple移行**: SwiftUI + SwiftData + CloudKit + Apple Watch（別フェーズ）。§4 の規約を守っていれば移行が楽。

---

## 8. 既知の注意点・落とし穴

- **pdf.js は Safari で要注意（実害あり・対処済み）**: `src/lib/payslip/extract.ts` は次の3点で Safari 対応している。崩すと iPhone で取込が壊れる。
  1. **legacy ビルドを使う**（`pdfjs-dist/legacy/build/...`）。
  2. **ワーカーは Vite の `?worker` でバンドルし `GlobalWorkerOptions.workerPort` に渡す**（`?url` で生URLを渡すと「Importing a module script failed」になる）。
  3. **`ReadableStream` の async iterator をポリフィル**（Safariは `for await...of ReadableStream` 未対応で、pdf.js の `getTextContent` が落ちる＝"undefined is not a function"）。
- **日本語PDF（CIDフォント）のテキスト抽出には CMap が必須（実害あり・対処済み）**: 楽天カード明細など日本語PDFは CID フォントで、pdf.js に **`cMapUrl` + `cMapPacked:true`** を渡さないと `getTextContent` が**空**を返す（半角ｶﾅが出ず、楽天明細が「読み取れませんでした」になる／警告 "Ensure that the `cMapUrl` API parameter is provided"）。`vite.config.ts` の `pdfCmaps` プラグインで `node_modules/pdfjs-dist/cmaps` を **dist/cmaps** へコピー＆開発時も `/cmaps/` で配信し、`extract.ts` が `cMapUrl = import.meta.env.BASE_URL + 'cmaps/'`（＝`/budget-tracker/cmaps/`）を全 `getDocument` に渡す。cmaps(1.7MB) はリポジトリに含めずビルド時コピー。
- **楽天明細パースの「行崩れ」対策（実害あり・対処済み）**: `extractPdfRows` は同じY座標(±3px)の断片を1行に束ねるが、ごく稀に1明細のセルが複数Yに分かれ、支払方法「1回払い」のうち**「払い」だけ別行に落ち「1回」が明細行に残る**ことがある（実例: 2026-06 の `APPLE COM BILL ¥1,645`）。旧実装は「払い」で分割して金額を拾っていたため、払いが無い行では**回数の「1」を金額に拾い ¥1 になる**（→6ヶ月合計が¥1,644過少、娯楽・サブスクだけズレる症状）。対処として `parse.ts` は**支払方法の「N回」を `/[0-9０-９]+\s*回/` で除去してから**先頭の金額を拾う（「払い」分割に依存しない）。6請求月すべてが請求額と一致することを `scratchpad` の replicate スクリプトで検証済み。
- **Azure F0 は月500ページ無料**。OCRは1取込=1ページ。個人利用なら十分。自動保存せず必ずレビュー（OCRは桁誤読がありうる）。
- **スキャン画像は Azure F0 の「1ファイル4MB上限」に注意（実害あり・対処済み）**: `extract.ts` の `renderPdfFirstPage` は OCR送信用画像を **JPEG** で出力し、4MB未満になるよう品質を自動調整する。**PNGで出すと CamScanner 等の高解像度写真PDFが4MBを超え、Azureが受信拒否→Edge Functionが非2xx→「OCRに失敗しました：Edge Function returned a non-2xx status code」**になる（プリンタ等の低ノイズPNGは4MB未満で通るため“特定のPDFだけ失敗”に見える）。元PDFが高解像度な場合は目標幅(約2200px)へ**縮小**もする（`scale=Math.min(3, targetWidth/base.width)`。`Math.max(1,…)`で下限1にすると縮小されず肥大化するので入れない）。
- **OCRエラーは実際の理由を表示する**: supabase-js の `functions.invoke` は非2xxだと汎用文言しか返さないため、`ocr.ts` は `error.context`(Response)のボディ`{error, detail}`を読んで Azure の実HTTPコード等を表示する。原因切り分け（4MB超=413/InvalidContentLength、キー失効=401、枠超過=429 など）はここを見る。
- **`.env` はリポジトリに含めない**（.gitignore 済み）。Supabase の URL と publishable key は `src/lib/supabase.ts` にフォールバックでハードコード済み。publishable key は公開前提で、データは RLS で保護。
- **PWA**: Service Worker は `vite-plugin-pwa`（autoUpdate）が生成。**アプリシェル＋取込チャンク（pdf.js本体 `extract-*.js`・ワーカー含む）をまとめて事前キャッシュ**する（`vite.config.ts` の workbox）。新バージョンは再読み込みで反映。
- **PWAの落とし穴（実害あり・対処済み）「Importing a module script failed」**: 取込チャンク(`extract-*.js`)を事前キャッシュから外す（旧 `globIgnores: ['**/extract-*.js']`）と、再デプロイでチャンクのハッシュが変わった際に、**古いアプリ殻（SWキャッシュ）が、サーバーから削除済みの旧 `extract-*.js` を動的import しようとして失敗**する（バージョン不整合）。→ **取込チャンクも `globPatterns` で事前キャッシュに含める**ことで、SWのバージョンと常に一致させて防ぐ（`navigateFallbackDenylist: [/\/assets\//]` で資産にindex.htmlを返さないのも併用、`maximumFileSizeToCacheInBytes` をワーカーサイズに合わせて拡大）。古い端末でキャッシュが残ってこのエラーが出る場合は、**プライベートタブで開く / Safari「設定→Safari→詳細→Webサイトデータ」で `github.io` を削除**して更新する。
- **デザインは iOS調（案A）＋ Liquid Glass 風**（オーナー承認済み・段階導入中）。背景は iOS グレー（`--bg`）、カードは枠線なし＋淡い影の「グループド」。**タブバーと入力(FAB)ボタンは浮遊するガラス**（`backdrop-filter: blur+saturate` ＋ `--glass-bg/--glass-edge/--glass-hi/--glass-cap`、`.tabbar`/`.tab.active::before`/`.fab`）。タブのアイコンは絵文字をやめ **App.svelte の `tabIcon` スニペット（Lucide風インラインSVG）**。Webでは本物の屈折は出ない（近似）。**第1段＝シェル（背景/カード/タブ/FAB）まで適用済み、各画面の中身は順次グループド化していく予定**。
- **ビルド時の a11y 警告**（モーダル背景やli等）は出るがビルド成功・動作に影響なし。
- **定期の重複計上防止はヒューリスティック**（同一カテゴリ・金額・日付・source='recurring'）。厳密にするなら transactions に recurring_rule_id 列を足す（スキーマ変更）。
- **GitHub Pages の base path** は `/budget-tracker/`（vite.config.ts の `repo`）。リポジトリ名を変えたらここも変更。
- Supabase 無料枠は長期未使用でプロジェクトが一時停止することがある（日常利用なら問題なし）。

---

## 9. ローカル開発

```bash
npm install
cp .env.example .env     # 任意。URL/keyを入れる（無くてもフォールバックで動く）
npm run dev              # http://localhost:5173
npm run dev -- --host    # 同一Wi-FiのiPhoneからも開ける
npm run check            # 型チェック（svelte-check + tsc）
npm run build            # 本番ビルド確認
```

---

## 10. デプロイ手順（iPhoneだけで完結）

このプロジェクトは **Claude Code on the web（クラウド実行）** で更新する運用。PCは不要。

1. Claude（アプリ/web）の Code で budget-tracker リポジトリにタスクを投げる
2. Claude Code がブランチを push して **PR を作成**（CLAUDE.md の更新も同じPRに含める＝§運用ルール）
3. GitHub（iPhoneでも可）で **PR を `main` にマージ**
4. `main` への push で `.github/workflows/deploy.yml` が走り、GitHub Pages へ自動デプロイ
5. `https://lorecajp.github.io/budget-tracker/` を再読み込み（PWAインストール済みなら自動更新）

※ Settings → Pages → Source は「GitHub Actions」。デプロイは **`main` への push でのみ** 発火。

---

## 11. 次にやると良いこと（推奨順）

1. CSV取込（使っているカード/銀行から順に。レビュー画面は PayslipImport を参考に）
2. データの JSON エクスポート（小さく安全・SwiftData移行の布石）
3. 定期の週次対応
4. 完全オフライン入力＋同期（PWA フェーズ2・大きめ）
5. 汎用レシートOCR

実装は必ず §4 の規約に従い、データ操作は `src/lib/db.ts` に集約。**そして変更したら CLAUDE.md も同じPRで更新する（冒頭の運用ルール）。**
