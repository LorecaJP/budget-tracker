-- ============================================================
-- シフト＆見込み（えみの扶養計画用・後から追加）
-- ------------------------------------------------------------
-- shifts:          えみの予定シフト（就労日＋時間）。見込み課税収入＝Σ時間×時給 の元。
--                  将来の Google カレンダー連携（方式2 ワンタップ同期）でもこの shifts を使う。
-- fuyou_overrides: 見込み額の手動上書き（就労月 'YYYY-MM' 単位。残業・早上がりのズレを手で直す）。
--
-- RLS は世帯共有（in_my_household）。**household_share.sql を適用済みの前提**で実行すること。
-- 未作成でもアプリは動く（取得は空配列フォールバック＝扶養タブの見込みが 0 表示になるだけ）。
-- ============================================================

create table if not exists shifts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person     text not null default 'えみ',
  work_date  date not null,
  start_min  integer not null,                 -- 開始（0時からの分。例 9:00=540）
  end_min    integer not null,                 -- 終了（0時からの分。例 17:00=1020）
  break_min  integer not null default 0,       -- 休憩（分）
  memo       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_shifts_date on shifts(user_id, work_date);
alter table shifts enable row level security;
drop policy if exists "household rw" on shifts;
create policy "household rw" on shifts for all
  using ( user_id = auth.uid() or in_my_household(user_id) )
  with check ( user_id = auth.uid() or in_my_household(user_id) );

create table if not exists fuyou_overrides (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person     text not null default 'えみ',
  work_month text not null,                     -- 'YYYY-MM'（就労月）
  amount     integer not null,                  -- 見込み課税額（円）
  created_at timestamptz not null default now(),
  unique (user_id, person, work_month)
);
alter table fuyou_overrides enable row level security;
drop policy if exists "household rw" on fuyou_overrides;
create policy "household rw" on fuyou_overrides for all
  using ( user_id = auth.uid() or in_my_household(user_id) )
  with check ( user_id = auth.uid() or in_my_household(user_id) );
