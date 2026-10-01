-- ============================================================
-- 新しい家計表（月 × 費目の「予定」と「実績」）
-- ------------------------------------------------------------
-- 目的: 「予算を入れて、実際に払った額も別に登録する」二重入力をやめ、
--       1つの行（その月のその費目）に 予定(planned) と 実績(actual) の両方を持たせる。
--       ・予定だけ入っている行 = まだ予定（薄字表示）
--       ・実績が入った行       = 確定（予定どおりなら1タップで planned を actual に写す）
--       ・予定と実績が違う行   = 両方が残る（ズレが分かる）
--       過去の月は記録、先の月は予測。表の形は同じ。
--
-- 行の種類(kind):
--   category = 費目（categories）の行。1か月×1費目で1行。
--   card     = クレジットカードの引落の行（account_id = カード口座）。
--              planned = その月に引き落とされるカードの合計（予定）、actual = 請求額（明細取込で確定）。
--              カード払いの費目（categories.card_account_id がこのカード）は自分の行に出し、
--              カードの行は画面上「合計 − カード払いの費目」＝「その他」として見せる（二重計上しない）。
--   extra    = 費目に紐づかない、その月だけの項目（name + division で持つ）。
--
-- 特別費は従来どおり special_expenses が元データ（毎月の表へは読み込んで表示する）。
--
-- 適用: Supabase ダッシュボード → SQL Editor で本ファイルを丸ごと実行。
--       世帯共有（household_share.sql）を適用済みなら世帯で共有、未適用なら本人のみの RLS になる。
--       ※後から世帯共有を適用した場合は、本ファイルをもう一度実行すると共有に切り替わる。
--       何度実行しても安全（if not exists / drop policy if exists）。
--       既存の表・データには一切手を加えない（categories への列追加のみ）。
-- 元に戻す: 末尾「9) ロールバック」。
-- ============================================================

-- ---------- 1) 月×費目の表 ----------
create table if not exists month_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_month  text not null check (period_month ~ '^[0-9]{4}-[0-9]{2}$'),   -- 'YYYY-MM'（予算月。25日始まりの「月」）
  kind          text not null default 'category' check (kind in ('category','card','extra')),
  category_id   uuid references categories(id) on delete cascade,             -- kind=category
  account_id    uuid references accounts(id) on delete cascade,               -- kind=card（カード口座）
  name          text,                                                          -- kind=extra
  division      text check (division in ('income','tax','saving','fixed','variable')),  -- kind=extra
  planned       integer,                                                       -- 予定（円）。null=予定なし
  actual        integer,                                                       -- 実績（円）。null=まだ予定のまま
  actual_source text check (actual_source in ('manual','payslip','card','migrated')),  -- 実績の出どころ
  memo          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint month_entries_shape check (
       (kind = 'category' and category_id is not null)
    or (kind = 'card'     and account_id  is not null)
    or (kind = 'extra'    and name is not null and division is not null)
  )
);
create index if not exists idx_month_entries_month on month_entries(user_id, period_month);
-- 同じ人が同じ月・同じ費目（カード）の行を2つ作らない（世帯内の重複はアプリ側で既存行を更新して防ぐ）
create unique index if not exists uq_month_entries_category
  on month_entries(user_id, period_month, category_id) where kind = 'category';
create unique index if not exists uq_month_entries_card
  on month_entries(user_id, period_month, account_id) where kind = 'card';

-- RLS：世帯共有を適用済みなら「同じ世帯で共有」、未適用なら「本人のみ」。
alter table month_entries enable row level security;
drop policy if exists "household rw" on month_entries;
drop policy if exists "own rows" on month_entries;
do $$
begin
  if to_regprocedure('in_my_household(uuid)') is not null then
    create policy "household rw" on month_entries for all
      using ( user_id = auth.uid() or in_my_household(user_id) )
      with check ( user_id = auth.uid() or in_my_household(user_id) );
  else
    create policy "own rows" on month_entries for all
      using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
  end if;
end $$;

-- ---------- 2) 費目の「カード払い」設定 ----------
-- この費目をどのカードで払っているか（null=カード払いではない）。
-- カード明細を取り込むとき、この費目の分を店名で見つけて実績に入れ、残りをカードの「その他」にする。
alter table categories add column if not exists card_account_id uuid references accounts(id) on delete set null;


-- ============================================================
-- 9) ロールバック（新しい表を撤去。既存の表・データには影響なし）
-- ============================================================
-- drop table if exists month_entries;
-- alter table categories drop column if exists card_account_id;
