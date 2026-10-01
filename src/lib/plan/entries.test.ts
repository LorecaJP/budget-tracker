import { describe, expect, it } from 'vitest'
import {
  budgetMonthKeyOf, buildMigration, entryStatus, entryValue, monthEnded, planMigration, shiftMonthKey,
  UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME, type EntryDraft,
} from './entries'

const cats = [
  { id: 'sal', division: 'income' as const },
  { id: 'tax', division: 'tax' as const },
  { id: 'food', division: 'variable' as const },
]
const tx = (date: string, amount: number, type: 'income' | 'expense' | 'transfer', category_id: string | null, source = 'manual') =>
  ({ date, amount, type, category_id, source: source as 'manual' | 'ocr' })

describe('entryValue / entryStatus', () => {
  it('実績があれば実績、無ければ予定', () => {
    expect(entryValue({ planned: 50000, actual: null })).toBe(50000)
    expect(entryValue({ planned: 50000, actual: 54300 })).toBe(54300)
    expect(entryValue({ planned: null, actual: null })).toBe(0)
  })
  it('予定のまま / 予定どおり確定 / 予定と違う確定 を区別する', () => {
    expect(entryStatus({ planned: null, actual: null })).toBe('empty')
    expect(entryStatus({ planned: 8800, actual: null })).toBe('plan')
    expect(entryStatus({ planned: 8800, actual: 8800 })).toBe('done')
    expect(entryStatus({ planned: 8800, actual: 9350 })).toBe('diff')
    expect(entryStatus({ planned: null, actual: 3000 })).toBe('done')
  })
})

describe('予算月', () => {
  it('25日始まり：24日までは前の月、25日からその月', () => {
    expect(budgetMonthKeyOf('2026-10-24', 25)).toBe('2026-09')
    expect(budgetMonthKeyOf('2026-10-25', 25)).toBe('2026-10')
    expect(budgetMonthKeyOf('2026-01-10', 25)).toBe('2025-12')
  })
  it('月をまたいでずらせる', () => {
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
  })
  it('翌月の開始日を過ぎたら「終わった月」', () => {
    expect(monthEnded('2026-09', '2026-10-24', 25)).toBe(false)
    expect(monthEnded('2026-09', '2026-10-25', 25)).toBe(true)
    expect(monthEnded('2026-12', '2027-01-25', 25)).toBe(true)
  })
})

describe('buildMigration', () => {
  const today = '2026-10-01'   // 9月（9/25〜10/24）の途中

  it('予算→予定、終わった月の取引合計→実績', () => {
    const drafts = buildMigration(
      [{ category_id: 'food', period_month: '2026-08', amount: 50000 }],
      [tx('2026-08-26', 30000, 'expense', 'food'), tx('2026-09-20', 24300, 'expense', 'food')],
      cats, 25, today,
    )
    expect(drafts).toEqual([
      { period_month: '2026-08', kind: 'category', category_id: 'food', name: null, division: null, planned: 50000, actual: 54300 },
    ])
  })

  it('途中の月は給与明細(ocr)の分だけ実績にする', () => {
    const drafts = buildMigration([], [
      tx('2026-09-25', 360000, 'income', 'sal', 'ocr'),
      tx('2026-09-26', 12000, 'expense', 'food'),
    ], cats, 25, today)
    expect(drafts.map(d => [d.category_id, d.actual])).toEqual([['sal', 360000]])
  })

  it('振替は含めず、カテゴリ無しは未分類の行にまとめる', () => {
    const drafts = buildMigration([], [
      tx('2026-08-26', 5000, 'transfer', null),
      tx('2026-08-27', 1200, 'expense', null),
      tx('2026-08-28', 800, 'expense', 'deleted-cat'),
      tx('2026-08-29', 5230, 'income', null),
    ], cats, 25, today)
    expect(drafts.map(d => [d.name, d.division, d.actual])).toEqual([
      [UNCATEGORIZED_INCOME, 'income', 5230],
      [UNCATEGORIZED_EXPENSE, 'variable', 2000],
    ])
  })

  it('支出側の費目への収入（年末調整の還付など）は差し引く', () => {
    const drafts = buildMigration([], [
      tx('2026-08-25', 9000, 'expense', 'tax', 'ocr'),
      tx('2026-08-25', 5230, 'income', 'tax', 'ocr'),
    ], cats, 25, today)
    expect(drafts[0].actual).toBe(3770)
  })

  it('予算0や存在しない費目の予算は写さない', () => {
    const drafts = buildMigration([
      { category_id: 'food', period_month: '2026-10', amount: 0 },
      { category_id: 'gone', period_month: '2026-10', amount: 1000 },
    ], [], cats, 25, today)
    expect(drafts).toEqual([])
  })
})

describe('planMigration（何度実行しても安全）', () => {
  const d = (over: Partial<EntryDraft>): EntryDraft => ({
    period_month: '2026-08', kind: 'category', category_id: 'food', name: null, division: null, planned: 50000, actual: 54300, ...over,
  })
  const row = (over: Record<string, unknown>) => ({
    id: 'e1', period_month: '2026-08', kind: 'category' as const, category_id: 'food', name: null, division: null,
    planned: null as number | null, actual: null as number | null, actual_source: null as 'manual' | 'migrated' | null, ...over,
  })

  it('行が無ければ追加（実績があれば出どころ=migrated）', () => {
    const p = planMigration([d({}), d({ category_id: 'sal', actual: null })], [])
    expect(p.inserts.map(i => [i.category_id, i.actual_source])).toEqual([['food', 'migrated'], ['sal', null]])
    expect(p.updates).toEqual([])
  })

  it('新しい画面で入れた予定・手で確定した実績は上書きしない', () => {
    const p = planMigration([d({})], [row({ planned: 48000, actual: 52000, actual_source: 'manual' })])
    expect(p.updates).toEqual([])
  })

  it('空の予定は埋め、前回写した実績は新しい合計に更新する', () => {
    const p = planMigration([d({})], [row({ planned: null, actual: 40000, actual_source: 'migrated' })])
    expect(p.updates).toEqual([{ id: 'e1', patch: { planned: 50000, actual: 54300, actual_source: 'migrated' } }])
  })

  it('同じ内容なら何もしない', () => {
    const p = planMigration([d({})], [row({ planned: 50000, actual: 54300, actual_source: 'migrated' })])
    expect(p.inserts).toEqual([])
    expect(p.updates).toEqual([])
  })
})
