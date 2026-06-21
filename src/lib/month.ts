// 予算月（家計簿上の「月」）の計算。
// 現状は開始日を定数で持つ。将来は settings.month_start_day から読む。
export const MONTH_START_DAY = 25

// ある日付がどの予算月に属するかを返す（month は 1-12）
export function budgetMonthOf(date: Date): { year: number; month: number } {
  let y = date.getFullYear()
  let m = date.getMonth() + 1
  if (date.getDate() < MONTH_START_DAY) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return { year: y, month: m }
}

// 予算月の範囲 [start, end)（end は翌予算月の開始日＝排他）
export function budgetMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month - 1, MONTH_START_DAY)
  const end = new Date(year, month, MONTH_START_DAY)
  return { start, end }
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function yen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

// 予算月を delta ヶ月ずらす
export function shiftBudgetMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = (year * 12 + (month - 1)) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

// 直近 n 個の予算月（古い順）
export function lastNBudgetMonths(year: number, month: number, n: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftBudgetMonth(year, month, -i))
  return out
}
