-- ============================================================
-- 作り替え①：割り当て（その月の使えるお金を、項目ごとに割り当てる）の入れ物
-- ------------------------------------------------------------
-- 考え方は CLAUDE.md §12。今ある表は使い回して列を足し、足りない所だけ表を新しく作る。
--   ・scheduled_payments（支払い予定）… 毎月の項目の「決まり」。収入も入れる。日付なし＝予算だけ。
--   ・special_expenses（特別費）       … 大きな支払い。払う日・くりかえし・毎月の積立額・今までに貯まっていた額。
--   ・accounts（口座）                 … 役割（給料の受け取り／割り当てに使える貯金）と残高。
--   ・plan_lines（新）                 … 月×項目の「予定の額・実際の額・割り当てた額」。
--   ・fund_uses（新）                  … 口座（貯金）のお金を、その月の使えるお金や大きな支払いに当てた記録。
--
-- 適用: Supabase ダッシュボード → SQL Editor で本ファイルを丸ごと実行。何度実行しても安全。
--       既存の行・データは変えない（列を足すだけ。足した列は既定値か空）。
--       世帯共有（household_share.sql）を適用済みなら新しい表は世帯で共有、未適用なら本人のみ。
-- 未適用でもアプリは今までどおり動く（新しい画面だけが空になる）。
-- 元に戻す: 末尾「9) ロールバック」。
-- ============================================================

-- ---------- 1) 支払い予定 → 毎月の項目の「決まり」 ----------
-- direction : out=支払い / in=収入（給料の予定など）
-- due_day   : 毎月の日（1-31。その月に無い日は月末）。due_day も due_date も空なら「日付なし＝予算だけ」（食費など）
-- active    : false で新しい画面に出さない（消さずに止める）
alter table scheduled_payments add column if not exists direction  text    not null default 'out';
alter table scheduled_payments add column if not exists sort_order integer not null default 0;
alter table scheduled_payments add column if not exists active     boolean not null default true;
alter table scheduled_payments drop constraint if exists scheduled_payments_direction_check;
alter table scheduled_payments add  constraint scheduled_payments_direction_check check (direction in ('out','in'));
-- 月末払い（えみの給料など）のため 1-28 → 1-31 に広げる
alter table scheduled_payments drop constraint if exists scheduled_payments_due_day_check;
alter table scheduled_payments add  constraint scheduled_payments_due_day_check check (due_day between 1 and 31);

-- ---------- 2) 特別費 → 大きな支払い ----------
-- due_day        : 払う日（1-31）。空なら「日にち未定」（その月の1日として扱う）
-- repeat         : once=1回だけ / yearly=毎年 / every2y=2年ごと
-- monthly_amount : 毎月の積立額の手入力。空なら自動（残り÷払う月までの回数）
-- saved_opening  : 新しい仕組みを使う前に、すでに貯まっていた額
-- account_id     : 払う口座（備え）
alter table special_expenses add column if not exists due_day        integer;
alter table special_expenses add column if not exists repeat         text not null default 'once';
alter table special_expenses add column if not exists monthly_amount integer;
alter table special_expenses add column if not exists saved_opening  integer not null default 0;
alter table special_expenses add column if not exists account_id     uuid references accounts(id) on delete set null;
alter table special_expenses drop constraint if exists special_expenses_due_day_check;
alter table special_expenses add  constraint special_expenses_due_day_check check (due_day between 1 and 31);
alter table special_expenses drop constraint if exists special_expenses_repeat_check;
alter table special_expenses add  constraint special_expenses_repeat_check check (repeat in ('once','yearly','every2y'));

-- ---------- 3) 口座 → 役割と残高 ----------
-- role : normal=ふつう / salary=給料の受け取り / savings=割り当てに使える貯金
--        （salary の口座は「口座から使う」に選べない＝給料と二重に数えないため）
alter table accounts add column if not exists role         text not null default 'normal';
alter table accounts add column if not exists balance      integer;
alter table accounts add column if not exists balance_date date;
alter table accounts drop constraint if exists accounts_role_check;
alter table accounts add  constraint accounts_role_check check (role in ('normal','salary','savings'));

-- ---------- 4) 月×項目の割り当て（新） ----------
-- period_month : 'YYYY-MM'（25日始まりの月＝その月の25日の給料で払う区切り。settings.month_start_day）
-- kind         : payment=毎月の項目（scheduled_payments） / big=大きな支払いの積立（special_expenses）
-- planned      : その月の予定額。空なら決まりの額（scheduled_payments.amount / 自動の積立額）
-- actual       : 実際の額（明細の取込や手入力）。空ならまだ
-- allocated    : 割り当てた額。空なら「未割り当て」
create table if not exists plan_lines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_month text not null check (period_month ~ '^[0-9]{4}-[0-9]{2}$'),
  kind         text not null check (kind in ('payment','big')),
  payment_id   uuid references scheduled_payments(id) on delete cascade,
  special_id   uuid references special_expenses(id) on delete cascade,
  planned      integer,
  actual       integer,
  allocated    integer,
  memo         text not null default '',
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint plan_lines_shape check (
       (kind = 'payment' and payment_id is not null and special_id is null)
    or (kind = 'big'     and special_id is not null and payment_id is null)
  )
);
create index if not exists idx_plan_lines_month on plan_lines(user_id, period_month);
-- 同じ月・同じ項目の行を2つ作らない（世帯内の重複はアプリ側で既存行を更新して防ぐ）
create unique index if not exists uq_plan_lines_payment on plan_lines(user_id, period_month, payment_id) where kind = 'payment';
create unique index if not exists uq_plan_lines_big     on plan_lines(user_id, period_month, special_id) where kind = 'big';

-- ---------- 5) 口座から使う額（新） ----------
-- special_id が空  … その月（period_month）の「使えるお金」に足す
-- special_id がある … その大きな支払いの積立済みに足す（period_month は当てた月）
create table if not exists fund_uses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_month text not null check (period_month ~ '^[0-9]{4}-[0-9]{2}$'),
  account_id   uuid references accounts(id) on delete set null,
  special_id   uuid references special_expenses(id) on delete cascade,
  amount       integer not null check (amount >= 0),
  memo         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists idx_fund_uses_month on fund_uses(user_id, period_month);

-- ---------- 6) RLS：世帯共有を適用済みなら世帯で共有、未適用なら本人のみ ----------
alter table plan_lines enable row level security;
alter table fund_uses  enable row level security;
drop policy if exists "household rw" on plan_lines;
drop policy if exists "own rows"     on plan_lines;
drop policy if exists "household rw" on fund_uses;
drop policy if exists "own rows"     on fund_uses;
do $$
begin
  if to_regprocedure('in_my_household(uuid)') is not null then
    create policy "household rw" on plan_lines for all
      using ( user_id = auth.uid() or in_my_household(user_id) )
      with check ( user_id = auth.uid() or in_my_household(user_id) );
    create policy "household rw" on fund_uses for all
      using ( user_id = auth.uid() or in_my_household(user_id) )
      with check ( user_id = auth.uid() or in_my_household(user_id) );
  else
    create policy "own rows" on plan_lines for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
    create policy "own rows" on fund_uses  for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
  end if;
end $$;


-- ============================================================
-- 9) ロールバック（新しい表と足した列を撤去。もともとあった列・データには影響なし）
-- ============================================================
-- drop table if exists fund_uses;
-- drop table if exists plan_lines;
-- alter table accounts drop constraint if exists accounts_role_check;
-- alter table accounts drop column if exists role, drop column if exists balance, drop column if exists balance_date;
-- alter table special_expenses drop constraint if exists special_expenses_due_day_check, drop constraint if exists special_expenses_repeat_check;
-- alter table special_expenses drop column if exists due_day, drop column if exists repeat, drop column if exists monthly_amount, drop column if exists saved_opening, drop column if exists account_id;
-- alter table scheduled_payments drop constraint if exists scheduled_payments_direction_check;
-- alter table scheduled_payments drop column if exists direction, drop column if exists sort_order, drop column if exists active;
-- alter table scheduled_payments drop constraint if exists scheduled_payments_due_day_check;
-- alter table scheduled_payments add  constraint scheduled_payments_due_day_check check (due_day between 1 and 28);
-- alter table scheduled_payments drop column if exists card_source;


-- ============================================================
-- 10) 作り替え④（2026-11-09 追加）：カードの明細を「実際の額」につなぐ
-- ------------------------------------------------------------
-- card_source : 'rakuten' の項目は、その月に引き落とされる楽天カードの請求の合計
--               （rakuten_transactions の statement_month ごとの合計）を「実際の額」として表示する。
--               手で入れた実際の額（plan_lines.actual）があればそちらが優先。割り当ては変えない。
-- この部分だけ後から実行してもよい（何度実行しても安全）。
-- ============================================================
alter table scheduled_payments add column if not exists card_source text;
alter table scheduled_payments drop constraint if exists scheduled_payments_card_source_check;
alter table scheduled_payments add  constraint scheduled_payments_card_source_check check (card_source in ('rakuten'));
