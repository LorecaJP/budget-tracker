-- ============================================================
-- 世帯共有（えみ専用ログイン）
-- ------------------------------------------------------------
-- 目的: ゆうき / えみ が「別々のログイン」を使いつつ、家計データは
--       「世帯」で1つを共有する。既存データは ゆうき 所有のまま、
--       RLS（行レベルセキュリティ）を「同じ世帯の行は閲覧/編集できる」に
--       置き換えるだけ（列追加・データ移行なし＝低リスク）。
--
-- 適用順（Supabase ダッシュボード → SQL Editor で実行）:
--   STEP 1: 下記「1) 仕組み」「2) RLS 置換」を実行（いつでも安全。実行しても
--           ゆうき の見え方は従来どおり＝自分の行のみ）。
--   STEP 2: えみ が アプリで「アカウントを作る」→ メール確認 → サインイン。
--   STEP 3: 「3) 連携」の YUUKI_EMAIL / EMI_EMAIL を実メールに書き換えて実行
--           （ゆうき=オーナー / えみ=メンバー を同じ世帯に登録 ＋ えみが連携前に
--             自動投入した初期データの掃除）。
--   → 以後 えみ は同じ世帯のデータが見え、アプリは「えみ表示」に切替わる。
--
-- 元に戻す: 「9) ロールバック」を実行（RLS を「本人のみ」に戻す）。
-- ============================================================


-- ---------- 1) 仕組み（テーブル＋関数） ----------

create table if not exists household_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null,
  person       text,                                   -- 'ゆうき' / 'えみ'（表示・出し分け用）
  role         text not null default 'member' check (role in ('owner','member')),
  created_at   timestamptz not null default now()
);
alter table household_members enable row level security;

-- 自分の世帯IDを返す。security definer で RLS をバイパスし、household_members を
-- 参照するポリシーの「無限再帰」を避ける（Supabase の定番の落とし穴）。
create or replace function my_household_id()
  returns uuid language sql stable security definer set search_path = public as $$
  select household_id from household_members where user_id = auth.uid() limit 1;
$$;

-- 指定 user_id が「自分と同じ世帯」か（自分自身も true）。
create or replace function in_my_household(row_user uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select row_user = auth.uid()
      or exists (
        select 1 from household_members m
        where m.user_id = row_user
          and m.household_id = (select household_id from household_members where user_id = auth.uid() limit 1)
      );
$$;

-- 世帯メンバー表 自体の RLS：同じ世帯のメンバー行は読める（アプリが誰=ゆうき/えみ かを判定するため）。
-- 書き込みは下の「3) 連携」を SQL Editor（service role）で行うので、アプリ用の write ポリシーは作らない。
drop policy if exists "read my household" on household_members;
create policy "read my household" on household_members
  for select using ( household_id = my_household_id() );


-- ---------- 2) RLS 置換（各表：本人のみ → 同じ世帯で共有） ----------
-- using / with check とも「自分の行 or 同じ世帯の行」。未連携（世帯なし）でも
-- 自分の行は見える＝従来どおり動く。未作成の表（後から追加した表）はスキップ。
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','categories','transactions','recurring_rules','budgets',
    'special_expenses','settings','scheduled_payments','payslip_details','rakuten_transactions'
  ] loop
    if to_regclass(t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('drop policy if exists "own settings" on %I', t);
    execute format('drop policy if exists "household rw" on %I', t);
    execute format($f$create policy "household rw" on %I for all
      using ( user_id = auth.uid() or in_my_household(user_id) )
      with check ( user_id = auth.uid() or in_my_household(user_id) )$f$, t);
  end loop;
end $$;


-- ---------- 3) 連携（オーナーが1回・メールを実際のものに書き換える） ----------
-- ↓ 2か所（3-1, 3-2, 3-3）の 'YUUKI_EMAIL' / 'EMI_EMAIL' を実メールに置換して実行。

-- 3-1) ゆうき を未登録なら世帯を作って owner 登録
insert into household_members (user_id, household_id, person, role)
select u.id, gen_random_uuid(), 'ゆうき', 'owner'
from auth.users u
where u.email = 'YUUKI_EMAIL'
  and not exists (select 1 from household_members m where m.user_id = u.id);

-- 3-2) えみ を ゆうき と同じ世帯に member 登録（再実行しても世帯を合わせる）
insert into household_members (user_id, household_id, person, role)
select e.id,
       (select m.household_id from household_members m
          join auth.users uo on uo.id = m.user_id
          where uo.email = 'YUUKI_EMAIL' limit 1),
       'えみ', 'member'
from auth.users e
where e.email = 'EMI_EMAIL'
on conflict (user_id) do update
  set household_id = excluded.household_id, person = 'えみ', role = 'member';

-- 3-3) えみが「連携前のサインイン」で自動投入した初期データ（口座/カテゴリ/設定）を掃除。
--      ※えみがまだ手入力していない前提。もし入力済みなら、消さずに中身を確認すること。
do $$
declare emi uuid := (select id from auth.users where email = 'EMI_EMAIL');
begin
  if emi is not null then
    delete from settings     where user_id = emi;
    delete from transactions where user_id = emi;   -- 通常は0件
    delete from categories   where user_id = emi;   -- budgets は categories の cascade で消える
    delete from accounts     where user_id = emi;
  end if;
end $$;


-- ============================================================
-- 9) ロールバック（RLS を元の「本人のみ」に戻す）
-- ============================================================
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'accounts','categories','transactions','recurring_rules','budgets',
--     'special_expenses','settings','scheduled_payments','payslip_details','rakuten_transactions'
--   ] loop
--     if to_regclass(t) is null then continue; end if;
--     execute format('drop policy if exists "household rw" on %I', t);
--     execute format($f$create policy "own rows" on %I for all
--       using ( user_id = auth.uid() ) with check ( user_id = auth.uid() )$f$, t);
--   end loop;
-- end $$;
-- -- 完全に撤去する場合は併せて:
-- --   drop policy if exists "read my household" on household_members;
-- --   drop function if exists in_my_household(uuid);
-- --   drop function if exists my_household_id();
-- --   drop table if exists household_members;
