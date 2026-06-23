-- ============================================================
-- 家計簿アプリ データモデル（Supabase / PostgreSQL）
-- フェーズ1：将来 SwiftData(@Model) にそのまま移せる形で設計
--
-- 設計ルール：
--   - 主キーは uuid（文字列ID）
--   - 金額は integer（円・正の値。小数誤差を避ける）
--   - 日付は date / timestamptz
--   - 種別・区分は text + CHECK 制約（将来 SwiftData の enum に対応）
--   - リレーションは相手の id 参照（FK）
--   - 全テーブルに user_id を持たせ、RLS で本人のみアクセス可
-- ============================================================

-- ---------- 口座 ----------
create table accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  type           text not null check (type in ('cash','bank','credit','emoney')),
  opening_balance integer not null default 0,   -- 円
  color          text,
  sort_order     integer not null default 0,
  archived       boolean not null default false,
  monthly_alloc  integer,                       -- 毎月この口座へ振り分ける計画額（配分プラン用・後から追加した列）
  created_at     timestamptz not null default now()
);
-- 既存DBには以下を実行（列追加）。未追加でもアプリは動く（配分プラン未設定として扱う）：
--   alter table accounts add column if not exists monthly_alloc integer;

-- ---------- カテゴリ ----------
-- division = 会計区分：収入 / 税金・社保 / 貯蓄 / 固定費 / 変動費
create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  division    text not null check (division in ('income','tax','saving','fixed','variable')),
  parent_id   uuid references categories(id) on delete set null,  -- 階層用（任意）
  color       text,
  icon        text,
  sort_order  integer not null default 0,
  archived    boolean not null default false,
  goal_amount integer,                              -- 貯金の目標額（貯蓄カテゴリ用・後から追加した列）
  created_at  timestamptz not null default now()
);
-- 既存DBには以下を実行（列追加）。未追加でもアプリは動く（目標未設定として扱う）：
--   alter table categories add column if not exists goal_amount integer;

-- ---------- 取引 ----------
-- 貯蓄（防衛費・各自貯金・特別費積立）は division='saving' のカテゴリへの取引として記録
-- 振替は type='transfer'：account_id=移動元、to_account_id=移動先
create table transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date          date not null,
  amount        integer not null,               -- 円・正の値
  type          text not null check (type in ('expense','income','transfer')),
  category_id   uuid references categories(id) on delete set null,
  account_id    uuid references accounts(id) on delete set null,
  to_account_id uuid references accounts(id) on delete set null,  -- 振替先
  person        text,                            -- 'ゆうき' / 'えみ' / null
  memo          text not null default '',
  source        text not null default 'manual' check (source in ('manual','recurring','csv','ocr')),
  needs_review  boolean not null default false,  -- CSV/OCR取込の未確認フラグ
  created_at    timestamptz not null default now()
);
create index idx_transactions_date on transactions(user_id, date);
create index idx_transactions_category on transactions(category_id);
create index idx_transactions_account on transactions(account_id);

-- ---------- 定期ルール（固定費・税金などの自動計上） ----------
create table recurring_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  amount       integer not null,
  type         text not null check (type in ('expense','income','transfer')),
  category_id  uuid references categories(id) on delete set null,
  account_id   uuid references accounts(id) on delete set null,
  cycle        text not null check (cycle in ('monthly','weekly')),
  day_of_month integer check (day_of_month between 1 and 31),  -- 毎月の計上日
  weekday      integer check (weekday between 0 and 6),         -- 毎週の曜日（0=日）
  start_date   date not null default current_date,
  end_date     date,
  active       boolean not null default true,
  memo         text not null default '',
  created_at   timestamptz not null default now()
);

-- ---------- 予算（カテゴリ×月） ----------
-- period_month は 'YYYY-MM'（予算月の識別。25日始まりの「月」もこの文字列で表す）
create table budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id  uuid not null references categories(id) on delete cascade,
  period_month text not null,                    -- 例 '2026-06'
  amount       integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, category_id, period_month)    -- ※Web側のみ。SwiftData移行時はコードで担保
);

-- ---------- 特別費（年間の臨時支出・積立対象） ----------
create table special_expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null,
  year           integer not null,
  planned_month  integer not null check (planned_month between 1 and 12),
  budget_amount  integer not null default 0,
  actual_amount  integer,                         -- null = 未消化（予定）
  is_reserved    boolean not null default true,   -- 積立対象か
  transaction_id uuid references transactions(id) on delete set null,  -- 支払いの紐付け
  created_at     timestamptz not null default now()
);

-- ---------- 支払い予定（引落の事前把握・キャッシュ準備用・後から追加した表） ----------
-- 請求額が確定してから引き落とされるまでの間に「いつ・どの口座に・いくら要るか」を把握する。
-- status: planned=予定(見込み) / confirmed=確定 / paid=支払済（必要額の集計から外れる）。
-- 既存DBには下記をそのまま実行（未作成でもアプリは動く＝支払いタブは空表示・追加時のみ要作成）。
create table if not exists scheduled_payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  amount      integer not null default 0,                       -- 確定額（円）
  due_date    date,                                             -- 引落日（単発のとき）
  due_day     integer check (due_day between 1 and 28),         -- 毎月くりかえしの引落日（休日は翌営業日へ補正して表示）
  account_id  uuid references accounts(id) on delete set null,  -- 引落口座
  category_id uuid references categories(id) on delete set null,
  status      text not null default 'planned' check (status in ('planned','confirmed','paid')),
  memo        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists idx_scheduled_due on scheduled_payments(user_id, due_date);
alter table scheduled_payments enable row level security;
create policy "own rows" on scheduled_payments for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 既にこの表を作成済みの場合は、毎月くりかえし対応のため次を実行：
--   alter table scheduled_payments add column if not exists due_day integer;
--   alter table scheduled_payments alter column due_date drop not null;

-- ---------- 設定（ユーザーごと1行） ----------
create table settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  month_start_day integer not null default 25 check (month_start_day between 1 and 28),  -- 25日始まり
  currency        text not null default 'JPY',
  emi_hourly_wage integer not null default 1180,     -- 扶養トラッカー：えみの時給（円）
  emi_year_cap    integer not null default 1030000,  -- 扶養トラッカー：年間上限（既定 103万円＝夫の会社の扶養手当の条件）
  updated_at      timestamptz not null default now()
);
-- 既存DB（settings 作成済み）には以下を実行して列を追加する：
--   alter table settings add column if not exists emi_hourly_wage integer not null default 1180;
--   alter table settings add column if not exists emi_year_cap    integer not null default 1030000;
-- ※未追加でもアプリは既定値（1180 / 1030000）で動作する（getFuyouConfig がフォールバック）。

-- ---------- 給与明細の追加項目（扶養トラッカーの蓄積用・後から追加した表） ----------
-- 取込時に 課税支給額・通勤手当・総労働時間(分) を保存する。person + pay_date で一意（再取込で更新）。
-- 既存DBには下記をそのまま実行（未作成でもアプリは動く＝扶養タブは総支給のみ表示・取込の保存は黙ってスキップ）。
create table if not exists payslip_details (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person         text not null,
  pay_date       date not null,
  gross          integer,
  taxable        integer,                          -- 課税支給額（手当・税の基準。通勤手当を除く／残業代は含む）
  commute        integer,                          -- 通勤手当（非課税）
  work_minutes   integer,                          -- 総労働時間（分。週20時間判定の材料）
  transaction_id uuid references transactions(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (user_id, person, pay_date)
);
alter table payslip_details enable row level security;
create policy "own rows" on payslip_details for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 楽天カード明細（家計簿本体とは別管理の分析用・後から追加した表） ----------
-- 楽天カードの請求明細PDFを取り込んで「何にいくら使ったか（カテゴリ/店・月/年）」を見る用。
-- 家計簿本体の transactions とは混ぜない（固定費の二重計上を避けるため）。
-- 取込は請求月(statement_month)単位で置き換え（同じ月を再取込しても重複しない）。
create table if not exists rakuten_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  use_date        date not null,                    -- 利用日
  merchant        text not null,                    -- 利用店名（生表記）
  amount          integer not null,                 -- 利用金額（円）
  person          text,                             -- '本人' / '家族'
  category        text not null default 'その他',   -- カード利用カテゴリ（自動判定・編集可）
  statement_month text not null,                    -- 'YYYY-MM'（請求月）
  created_at      timestamptz not null default now()
);
create index if not exists idx_rakuten_month on rakuten_transactions(user_id, statement_month);
alter table rakuten_transactions enable row level security;
create policy "own rows" on rakuten_transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- Row Level Security（本人のデータのみアクセス可）
-- ============================================================
alter table accounts          enable row level security;
alter table categories        enable row level security;
alter table transactions      enable row level security;
alter table recurring_rules   enable row level security;
alter table budgets           enable row level security;
alter table special_expenses  enable row level security;
alter table settings          enable row level security;

create policy "own rows" on accounts          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on categories        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on transactions      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on recurring_rules   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on budgets           for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on special_expenses  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own settings" on settings      for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- 参考：初期カテゴリ（Excelの設定シートより）
-- ※ seed はアプリ初回起動時に投入するのが安全（auth.uid() を使うため）。
--   下記は登録したい項目の一覧メモ。
--
-- 収入(income)        : ゆうき給料, ボーナス, えみ給料
-- 税金・社保(tax)      : 所得税, 住民税, 健康保険, 厚生年金, 雇用保険
-- 貯蓄(saving)        : 防衛費, 特別費, ゆうき貯金, えみ貯金
-- 固定費(fixed)       : 家賃+駐車場代, 水道代, 電気代, 浄水器代, Wi-Fi代,
--                       携帯代, 生命保険, ジム代, 定期代・交通費
-- 変動費(variable)    : 食費, 日用品代, 交際費, ゆうきおこづかい, えみおこづかい
-- ============================================================

-- ============================================================
-- 世帯共有（えみ専用ログイン・後から追加）
-- ------------------------------------------------------------
-- ゆうき / えみ が別々のログインで同じ家計データを共有するための仕組み。
-- 既存データは ゆうき 所有のまま、上の各表の「本人のみ(own rows)」RLS を
-- 「同じ世帯なら閲覧/編集可(household rw)」へ置き換える（列追加・データ移行なし）。
-- ▼ 既存DBへの適用・連携・ロールバックの実行手順は supabase/household_share.sql を参照。
--   ここは定義の控え（source of truth）。
-- ============================================================

-- 世帯メンバー（誰がどの世帯か＋person='ゆうき'/'えみ'）
create table if not exists household_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null,
  person       text,                                   -- 'ゆうき' / 'えみ'（表示・出し分け用）
  role         text not null default 'member' check (role in ('owner','member')),
  created_at   timestamptz not null default now()
);
alter table household_members enable row level security;

-- security definer で RLS をバイパス（household_members を参照するポリシーの無限再帰を回避）
create or replace function my_household_id()
  returns uuid language sql stable security definer set search_path = public as $$
  select household_id from household_members where user_id = auth.uid() limit 1;
$$;
create or replace function in_my_household(row_user uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select row_user = auth.uid()
      or exists (
        select 1 from household_members m
        where m.user_id = row_user
          and m.household_id = (select household_id from household_members where user_id = auth.uid() limit 1)
      );
$$;

create policy "read my household" on household_members
  for select using ( household_id = my_household_id() );

-- 各データ表の RLS は「own rows / own settings」を廃し、下記に統一する（household_share.sql で一括置換）:
--   create policy "household rw" on <table> for all
--     using ( user_id = auth.uid() or in_my_household(user_id) )
--     with check ( user_id = auth.uid() or in_my_household(user_id) );
-- 対象: accounts, categories, transactions, recurring_rules, budgets,
--       special_expenses, settings, scheduled_payments, payslip_details, rakuten_transactions
