import { supabase } from './supabase'
import type { Account, Category, Transaction, Division, TxType } from './types'

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
export async function upsertAccount(a: Partial<Account> & { id?: string }) {
  if (a.id) return supabase.from('accounts').update(a).eq('id', a.id)
  return supabase.from('accounts').insert(a)
}
export async function archiveAccount(id: string, archived: boolean) {
  return supabase.from('accounts').update({ archived }).eq('id', id)
}

// ---------- カテゴリ CRUD ----------
export async function upsertCategory(c: Partial<Category> & { id?: string }) {
  if (c.id) return supabase.from('categories').update(c).eq('id', c.id)
  return supabase.from('categories').insert(c)
}
export async function archiveCategory(id: string, archived: boolean) {
  return supabase.from('categories').update({ archived }).eq('id', id)
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
