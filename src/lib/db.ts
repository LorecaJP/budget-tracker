import { supabase } from './supabase'
import type { Account, Category, Transaction, Division, TxType, ScheduledPayment, ScheduledStatus, RakutenTx } from './types'

// ---------- 取得 ----------
export async function listAccounts(includeArchived = false): Promise<Account[]> {
  let q = supabase.from('accounts').select('*').order('sort_order')
  if (!includeArchived) q = q.eq('archived', false)
  const { data } = await q
  return (data ?? []) as Account[]
}

export async function listCategories(includeArchived = false): Promise<Category[]> {
  let q = supabase.from('categories').select('*').order('sort_order')
  if (!includeArchived) q = q.eq('archived', false)
  const { data } = await q
  return (data ?? []) as Category[]
}

export interface TxFilter {
  type?: TxType | ''
  categoryId?: string
  accountId?: string
  person?: string
}

export async function listTransactions(startISO: string, endISO: string, f: TxFilter = {}): Promise<Transaction[]> {
  let q = supabase.from('transactions').select('*')
    .gte('date', startISO).lt('date', endISO)
    .order('date', { ascending: false }).order('created_at', { ascending: false })
  if (f.type) q = q.eq('type', f.type)
  if (f.categoryId) q = q.eq('category_id', f.categoryId)
  if (f.accountId) q = q.eq('account_id', f.accountId)
  if (f.person) q = q.eq('person', f.person)
  const { data } = await q
  return (data ?? []) as Transaction[]
}

// ---------- 取引 CRUD ----------
export interface TxInput {
  date: string; amount: number; type: TxType
  category_id: string | null; account_id: string | null; to_account_id?: string | null
  person: string | null; memo: string; source?: string
}
export async function insertTransaction(t: TxInput) {
  return supabase.from('transactions').insert({ source: 'manual', ...t })
}
export async function updateTransaction(id: string, t: Partial<TxInput>) {
  return supabase.from('transactions').update(t).eq('id', id)
}
export async function deleteTransaction(id: string) {
  return supabase.from('transactions').delete().eq('id', id)
}

// ---------- 口座 CRUD ----------
export async function upsertAccount(a: Partial<Account> & { id?: string; user_id?: string }) {
  if (a.id) return supabase.from('accounts').update(a).eq('id', a.id)
  return supabase.from('accounts').insert(a)
}
export async function archiveAccount(id: string, archived: boolean) {
  return supabase.from('accounts').update({ archived }).eq('id', id)
}
// 毎月この口座へ振り分ける計画額を設定（accounts.monthly_alloc。列未追加だとエラーを返す）
export async function setAccountAlloc(id: string, amount: number | null) {
  return supabase.from('accounts').update({ monthly_alloc: amount }).eq('id', id)
}

// ---------- カテゴリ CRUD ----------
export async function upsertCategory(c: Partial<Category> & { id?: string; user_id?: string }) {
  if (c.id) return supabase.from('categories').update(c).eq('id', c.id)
  return supabase.from('categories').insert(c)
}
export async function archiveCategory(id: string, archived: boolean) {
  return supabase.from('categories').update({ archived }).eq('id', id)
}
// 貯金の目標額を設定（categories.goal_amount。列未追加だとエラーを返す）
export async function setCategoryGoal(id: string, goal: number | null) {
  return supabase.from('categories').update({ goal_amount: goal }).eq('id', id)
}
// 指定カテゴリ群への支出（＝貯蓄の積立）の累計を category_id ごとに合計（全期間）
export async function sumSavingByCategory(categoryIds: string[]): Promise<Record<string, number>> {
  if (categoryIds.length === 0) return {}
  const { data } = await supabase.from('transactions').select('category_id, amount')
    .eq('type', 'expense').in('category_id', categoryIds)
  const m: Record<string, number> = {}
  for (const t of (data ?? []) as { category_id: string | null; amount: number }[]) {
    if (t.category_id) m[t.category_id] = (m[t.category_id] ?? 0) + t.amount
  }
  return m
}

// ---------- 予算 ----------
export interface Budget { id: string; category_id: string; period_month: string; amount: number }
export async function listBudgets(periodMonth: string): Promise<Budget[]> {
  const { data } = await supabase.from('budgets').select('*').eq('period_month', periodMonth)
  return (data ?? []) as Budget[]
}
export async function setBudget(categoryId: string, periodMonth: string, amount: number, userId: string) {
  // 既存があれば更新、なければ作成
  const { data } = await supabase.from('budgets').select('id')
    .eq('category_id', categoryId).eq('period_month', periodMonth).maybeSingle()
  if (data?.id) return supabase.from('budgets').update({ amount }).eq('id', data.id)
  return supabase.from('budgets').insert({ category_id: categoryId, period_month: periodMonth, amount, user_id: userId })
}
// 指定した年の12予算月（'Y-01'〜'Y-12'）の予算をまとめて取得（年間・月次ビューの「予定額」用）
export async function listBudgetsForYear(year: number): Promise<Budget[]> {
  const { data } = await supabase.from('budgets').select('*')
    .gte('period_month', `${year}-01`).lte('period_month', `${year}-12`)
  return (data ?? []) as Budget[]
}
// あるカテゴリの予算を、その年の12予算月すべてに同額で設定（固定費の一括入力用）。
// amount<=0 のときはその年の該当カテゴリの予算行を削除（＝未設定に戻す）。
export async function setBudgetAllMonths(categoryId: string, year: number, amount: number, userId: string) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  if (amount <= 0) {
    return supabase.from('budgets').delete().eq('category_id', categoryId)
      .gte('period_month', `${year}-01`).lte('period_month', `${year}-12`)
  }
  const { data } = await supabase.from('budgets').select('period_month')
    .eq('category_id', categoryId).gte('period_month', `${year}-01`).lte('period_month', `${year}-12`)
  const have = new Set((data ?? []).map(b => (b as { period_month: string }).period_month))
  const toInsert = months.filter(m => !have.has(m))
  const toUpdate = months.filter(m => have.has(m))
  if (toUpdate.length) {
    await supabase.from('budgets').update({ amount }).eq('category_id', categoryId).in('period_month', toUpdate)
  }
  if (toInsert.length) {
    await supabase.from('budgets').insert(
      toInsert.map(m => ({ category_id: categoryId, period_month: m, amount, user_id: userId }))
    )
  }
}

// ---------- 定期 ----------
export interface Recurring {
  id: string; name: string; amount: number; type: TxType
  category_id: string | null; account_id: string | null
  cycle: string; day_of_month: number | null; active: boolean; memo: string
}
export async function listRecurring(): Promise<Recurring[]> {
  const { data } = await supabase.from('recurring_rules').select('*').order('day_of_month')
  return (data ?? []) as Recurring[]
}
export async function upsertRecurring(r: Partial<Recurring> & { id?: string; user_id?: string }) {
  if (r.id) return supabase.from('recurring_rules').update(r).eq('id', r.id)
  return supabase.from('recurring_rules').insert(r)
}
export async function deleteRecurring(id: string) {
  return supabase.from('recurring_rules').delete().eq('id', id)
}

// 指定した予算月に、未計上の定期を取引として投入（重複防止つき）
export async function postRecurringForMonth(year: number, month: number, startDay: number, existing: Transaction[]) {
  const rules = (await listRecurring()).filter(r => r.active && r.cycle === 'monthly')
  let posted = 0
  for (const r of rules) {
    const day = Math.min(r.day_of_month ?? startDay, 28)
    // 予算月の境界に合わせて暦日を決める（開始日以上ならその月、未満なら翌月扱い）
    const cal = day >= startDay ? new Date(year, month - 1, day) : new Date(year, month, day)
    const iso = `${cal.getFullYear()}-${String(cal.getMonth() + 1).padStart(2, '0')}-${String(cal.getDate()).padStart(2, '0')}`
    const dup = existing.some(t => t.source === 'recurring' && t.category_id === r.category_id && t.amount === r.amount && t.date === iso)
    if (dup) continue
    const { error } = await supabase.from('transactions').insert({
      date: iso, amount: r.amount, type: r.type, category_id: r.category_id,
      account_id: r.account_id, person: null, memo: r.memo || r.name, source: 'recurring',
    })
    if (!error) posted++
  }
  return posted
}

// ---------- 特別費 ----------
export interface SpecialExpense {
  id: string; name: string; year: number; planned_month: number
  budget_amount: number; actual_amount: number | null; is_reserved: boolean
}
export async function listSpecialExpenses(year: number): Promise<SpecialExpense[]> {
  const { data } = await supabase.from('special_expenses').select('*')
    .eq('year', year).order('planned_month')
  return (data ?? []) as SpecialExpense[]
}
export async function upsertSpecialExpense(s: Partial<SpecialExpense> & { id?: string; user_id?: string }) {
  if (s.id) return supabase.from('special_expenses').update(s).eq('id', s.id)
  return supabase.from('special_expenses').insert(s)
}
export async function deleteSpecialExpense(id: string) {
  return supabase.from('special_expenses').delete().eq('id', id)
}

// ---------- 設定（1ユーザー1行） ----------
export interface AppSettings { month_start_day: number; currency: string }
export async function getSettings(): Promise<AppSettings | null> {
  const { data } = await supabase.from('settings').select('month_start_day, currency').maybeSingle()
  return (data as AppSettings) ?? null
}
export async function saveSettings(s: Partial<AppSettings>, userId: string) {
  // 既存があれば更新、なければ作成（PK は user_id）
  const { data } = await supabase.from('settings').select('user_id').maybeSingle()
  if (data) return supabase.from('settings').update(s).eq('user_id', userId)
  return supabase.from('settings').insert({ ...s, user_id: userId })
}

// ---------- 扶養トラッカー（えみ）----------
// 設定は settings テーブルに相乗り（emi_hourly_wage / emi_year_cap）。
// 列が未追加でも動くよう、取得はエラー時に既定値へフォールバックする。
export interface FuyouConfig { hourly_wage: number; year_cap: number }
const FUYOU_DEFAULT: FuyouConfig = { hourly_wage: 1180, year_cap: 1030000 }   // 時給1,180円 / 103万円（夫の会社の扶養手当の条件）

export async function getFuyouConfig(): Promise<FuyouConfig> {
  const { data, error } = await supabase.from('settings').select('emi_hourly_wage, emi_year_cap').maybeSingle()
  if (error || !data) return { ...FUYOU_DEFAULT }
  const d = data as { emi_hourly_wage: number | null; emi_year_cap: number | null }
  return {
    hourly_wage: d.emi_hourly_wage ?? FUYOU_DEFAULT.hourly_wage,
    year_cap: d.emi_year_cap ?? FUYOU_DEFAULT.year_cap,
  }
}
export async function saveFuyouConfig(c: FuyouConfig, userId: string) {
  const payload = { emi_hourly_wage: Math.round(c.hourly_wage), emi_year_cap: Math.round(c.year_cap) }
  const { data } = await supabase.from('settings').select('user_id').maybeSingle()
  if (data) return supabase.from('settings').update(payload).eq('user_id', userId)
  return supabase.from('settings').insert({ ...payload, user_id: userId })
}
// 指定した暦年(1/1〜12/31)の「えみ給料」収入を取得（支給日ベース）
export async function listEmiSalaryYear(year: number): Promise<Transaction[]> {
  const cats = await listCategories(true)
  const emi = cats.find(c => c.name === 'えみ給料')
  if (!emi) return []
  return listTransactions(`${year}-01-01`, `${year + 1}-01-01`, { type: 'income', categoryId: emi.id })
}

// 給与明細の追加項目（課税支給額・通勤手当・総労働時間）。扶養トラッカーの蓄積表示に使う。
// テーブル payslip_details が未作成でも、取得は空配列にフォールバックして既存どおり動く。
export interface PayslipDetail {
  person: string; pay_date: string
  gross: number | null; taxable: number | null; commute: number | null; work_minutes: number | null
  transaction_id?: string | null
}
export async function upsertPayslipDetail(d: PayslipDetail) {
  // person + pay_date で一意。user_id は列の default auth.uid() に任せる（transactions と同様）。
  const { data } = await supabase.from('payslip_details').select('id')
    .eq('person', d.person).eq('pay_date', d.pay_date).maybeSingle()
  if (data?.id) return supabase.from('payslip_details').update(d).eq('id', data.id)
  return supabase.from('payslip_details').insert(d)
}
export async function listPayslipDetails(year: number, person = 'えみ'): Promise<PayslipDetail[]> {
  const { data, error } = await supabase.from('payslip_details').select('*')
    .eq('person', person).gte('pay_date', `${year}-01-01`).lt('pay_date', `${year + 1}-01-01`)
  if (error || !data) return []   // テーブル未作成なら空
  return data as PayslipDetail[]
}

// ---------- 支払い予定（引落の事前把握・キャッシュ準備用） ----------
// テーブル scheduled_payments が未作成でも、取得は空配列にフォールバックして既存どおり動く。
export interface ScheduledInput {
  name: string; amount: number; due_date: string
  account_id: string | null; category_id: string | null
  status?: ScheduledStatus; memo?: string
}
export async function listScheduledPayments(includePaid = false): Promise<ScheduledPayment[]> {
  let q = supabase.from('scheduled_payments').select('*').order('due_date')
  if (!includePaid) q = q.neq('status', 'paid')
  const { data, error } = await q
  if (error || !data) return []   // 未作成でも動く
  return data as ScheduledPayment[]
}
export async function upsertScheduledPayment(p: Partial<ScheduledPayment> & { id?: string; user_id?: string }) {
  if (p.id) return supabase.from('scheduled_payments').update(p).eq('id', p.id)
  return supabase.from('scheduled_payments').insert(p)
}
export async function deleteScheduledPayment(id: string) {
  return supabase.from('scheduled_payments').delete().eq('id', id)
}
export async function setScheduledStatus(id: string, status: ScheduledStatus) {
  return supabase.from('scheduled_payments').update({ status }).eq('id', id)
}

// ---------- 楽天カード明細（別管理の分析用） ----------
// テーブル未作成でも取得は空配列にフォールバック。
export interface RakutenItemInput {
  use_date: string; merchant: string; amount: number; person: string; category: string
}
export async function listRakutenTx(): Promise<RakutenTx[]> {
  const { data, error } = await supabase.from('rakuten_transactions').select('*')
    .order('use_date', { ascending: false })
  if (error || !data) return []
  return data as RakutenTx[]
}
// 請求月(statement_month)単位で置き換え（再取込で重複しない）。
// 既定では手直し済みの店カテゴリを引き継ぐ。recategorize=true なら引き継がず、
// 取込時の自動分類（parse.ts の最新ルール）で全件を上書きする（ルール更新の反映用）。
export async function replaceRakutenStatement(statementMonth: string, items: RakutenItemInput[], recategorize = false) {
  const map = new Map<string, string>()
  if (!recategorize) {
    const { data: ex } = await supabase.from('rakuten_transactions').select('merchant, category')
    for (const r of (ex ?? []) as { merchant: string; category: string }[]) map.set(r.merchant, r.category)
  }
  await supabase.from('rakuten_transactions').delete().eq('statement_month', statementMonth)
  const rows = items.map(it => ({
    use_date: it.use_date, merchant: it.merchant, amount: it.amount, person: it.person,
    category: map.get(it.merchant) ?? it.category, statement_month: statementMonth,
  }))
  return supabase.from('rakuten_transactions').insert(rows)
}
// 店名でカテゴリを一括変更（手直し）。
export async function updateRakutenCategoryByMerchant(merchant: string, category: string) {
  return supabase.from('rakuten_transactions').update({ category }).eq('merchant', merchant)
}

// 給与明細の再取込時、同じ明細で前回登録した取引（収入＋控除）を置き換えるために削除する。
// memo の識別マーカー(#ps:...)が一致するもの、または旧データ（マーカー無し）の同一人・同日のOCR取引を消す。
export async function deleteOcrPayslipTx(date: string, person: string | null, marker: string): Promise<number> {
  let q = supabase.from('transactions').select('id, memo').eq('date', date).eq('source', 'ocr')
  if (person) q = q.eq('person', person)   // 別人の明細は消さない
  const { data } = await q
  const ids = (data ?? [])
    .filter(t => { const m = (t as { memo?: string }).memo ?? ''; return m.includes(marker) || !m.includes('#ps:') })
    .map(t => (t as { id: string }).id)
  if (ids.length) await supabase.from('transactions').delete().in('id', ids)
  return ids.length
}
