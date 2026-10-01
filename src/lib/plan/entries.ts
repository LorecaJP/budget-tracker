// 新しい家計表（month_entries）のロジック。UI・DBから切り離した純粋関数だけを置く（単体テスト対象）。
// 1か月×1費目＝1行に「予定(planned)」と「実績(actual)」を持つ。
import type { Category, Division, MonthEntry, Transaction } from '../types'

// ---------- 行の値と状態 ----------
export type EntryStatus = 'empty' | 'plan' | 'done' | 'diff'

// 表に出す金額：実績があれば実績、無ければ予定
export function entryValue(e: Pick<MonthEntry, 'planned' | 'actual'>): number {
  return e.actual ?? e.planned ?? 0
}

// empty=予定も実績も無い / plan=まだ予定のまま / done=予定どおり確定 / diff=予定と違う額で確定
export function entryStatus(e: Pick<MonthEntry, 'planned' | 'actual'>): EntryStatus {
  if (e.actual == null) return e.planned == null ? 'empty' : 'plan'
  return e.planned == null || e.actual === e.planned ? 'done' : 'diff'
}

// ---------- 予算月（'YYYY-MM'）----------
// 'YYYY-MM-DD' がどの予算月に属するか。文字列で計算するのでタイムゾーンに依存しない。
export function budgetMonthKeyOf(dateISO: string, startDay: number): string {
  const y = Number(dateISO.slice(0, 4))
  const m = Number(dateISO.slice(5, 7))
  const d = Number(dateISO.slice(8, 10))
  return d >= startDay ? monthKey(y, m) : shiftMonthKey(monthKey(y, m), -1)
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function shiftMonthKey(key: string, delta: number): string {
  const idx = Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1) + delta
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1)
}

// 予算月が todayISO の時点で終わっているか（翌予算月の開始日を過ぎたか）
export function monthEnded(key: string, todayISO: string, startDay: number): boolean {
  const next = shiftMonthKey(key, 1)
  return todayISO >= `${next}-${String(startDay).padStart(2, '0')}`
}

// ---------- 今のデータ（予算＋取引）→ 新しい表への写し ----------
export interface BudgetRow { category_id: string; period_month: string; amount: number }

export interface EntryDraft {
  period_month: string
  kind: 'category' | 'extra'
  category_id: string | null
  name: string | null
  division: Division | null
  planned: number | null
  actual: number | null
}

export const UNCATEGORIZED_INCOME = '未分類の収入'
export const UNCATEGORIZED_EXPENSE = '未分類の支出'

export function draftKey(d: Pick<EntryDraft, 'period_month' | 'kind' | 'category_id' | 'name' | 'division'>): string {
  return d.kind === 'category'
    ? `${d.period_month}|c|${d.category_id}`
    : `${d.period_month}|x|${d.division}|${d.name}`
}

// 予算 → 予定、取引の合計 → 実績 として、月×費目の下書きを作る。
// ・振替は含めない。
// ・金額の向きは費目の区分に合わせる（収入の費目は収入で＋、支出側の費目は支出で＋。
//   逆向き＝年末調整の還付で税が減る等は差し引く）。
// ・カテゴリの無い取引（または削除済みカテゴリ）は「未分類の収入／支出」の行にまとめる。
// ・実績は「終わった月」だけ写す。途中の月は合計が途中経過なので、給与明細の取込(ocr)分だけ写す
//   （例：今月の食費の途中合計を「確定」扱いにしない）。
export function buildMigration(
  budgets: BudgetRow[],
  transactions: Pick<Transaction, 'date' | 'amount' | 'type' | 'category_id' | 'source'>[],
  categories: Pick<Category, 'id' | 'division'>[],
  startDay: number,
  todayISO: string,
): EntryDraft[] {
  const catDiv = new Map(categories.map(c => [c.id, c.division]))
  const drafts = new Map<string, EntryDraft>()
  const get = (base: Omit<EntryDraft, 'planned' | 'actual'>): EntryDraft => {
    const k = draftKey(base)
    let d = drafts.get(k)
    if (!d) { d = { ...base, planned: null, actual: null }; drafts.set(k, d) }
    return d
  }

  for (const b of budgets) {
    if (!catDiv.has(b.category_id) || !b.amount) continue
    const d = get({ period_month: b.period_month, kind: 'category', category_id: b.category_id, name: null, division: null })
    d.planned = (d.planned ?? 0) + b.amount
  }

  const endedCache = new Map<string, boolean>()
  for (const t of transactions) {
    if (t.type === 'transfer') continue
    const pm = budgetMonthKeyOf(t.date, startDay)
    let ended = endedCache.get(pm)
    if (ended === undefined) { ended = monthEnded(pm, todayISO, startDay); endedCache.set(pm, ended) }
    if (!ended && t.source !== 'ocr') continue

    const div = t.category_id ? catDiv.get(t.category_id) : undefined
    let d: EntryDraft
    let sign: number
    if (div) {
      d = get({ period_month: pm, kind: 'category', category_id: t.category_id, name: null, division: null })
      sign = (div === 'income') === (t.type === 'income') ? 1 : -1
    } else {
      const income = t.type === 'income'
      d = get({
        period_month: pm, kind: 'extra', category_id: null,
        name: income ? UNCATEGORIZED_INCOME : UNCATEGORIZED_EXPENSE, division: income ? 'income' : 'variable',
      })
      sign = 1
    }
    d.actual = (d.actual ?? 0) + sign * t.amount
  }

  return [...drafts.values()].sort((a, b) => (draftKey(a) < draftKey(b) ? -1 : 1))
}

// ---------- 既存の新しい表と突き合わせ（何度実行しても安全にする）----------
export interface MigrationPlan {
  inserts: (EntryDraft & { actual_source: 'migrated' | null })[]
  updates: { id: string; patch: { planned?: number; actual?: number; actual_source?: 'migrated' } }[]
}

// ・まだ行が無ければ追加。
// ・行があれば、予定は「空のときだけ」埋める（新しい画面で入れた予定を上書きしない）。
// ・実績は「空、または前回この写しで入れたもの」だけ更新する（手で確定した実績・明細取込の実績は守る）。
export function planMigration(
  drafts: EntryDraft[],
  existing: Pick<MonthEntry, 'id' | 'period_month' | 'kind' | 'category_id' | 'name' | 'division' | 'planned' | 'actual' | 'actual_source'>[],
): MigrationPlan {
  const byKey = new Map(existing.filter(e => e.kind !== 'card').map(e => [draftKey(e as EntryDraft), e]))
  const plan: MigrationPlan = { inserts: [], updates: [] }
  for (const d of drafts) {
    const e = byKey.get(draftKey(d))
    if (!e) {
      plan.inserts.push({ ...d, actual_source: d.actual != null ? 'migrated' : null })
      continue
    }
    const patch: MigrationPlan['updates'][number]['patch'] = {}
    if (e.planned == null && d.planned != null) patch.planned = d.planned
    if (d.actual != null && (e.actual == null || e.actual_source === 'migrated') && e.actual !== d.actual) {
      patch.actual = d.actual
      patch.actual_source = 'migrated'
    }
    if (Object.keys(patch).length) plan.updates.push({ id: e.id, patch })
  }
  return plan
}
