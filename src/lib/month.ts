// 予算月（家計簿上の「月」）の計算。
// 開始日は settings.month_start_day から読み込む。App 起動時に setMonthStartDay で
// 反映し、未取得時は既定の 25 を使う。各関数は startDay を明示指定もできる。
let monthStartDay = 25

export function getMonthStartDay(): number { return monthStartDay }
export function setMonthStartDay(day: number): void {
  if (Number.isFinite(day) && day >= 1 && day <= 28) monthStartDay = Math.round(day)
}

// ある日付がどの予算月に属するかを返す（month は 1-12）
export function budgetMonthOf(date: Date, startDay: number = monthStartDay): { year: number; month: number } {
  let y = date.getFullYear()
  let m = date.getMonth() + 1
  if (date.getDate() < startDay) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return { year: y, month: m }
}

// 予算月の範囲 [start, end)（end は翌予算月の開始日＝排他）
export function budgetMonthRange(year: number, month: number, startDay: number = monthStartDay): { start: Date; end: Date } {
  const start = new Date(year, month - 1, startDay)
  const end = new Date(year, month, startDay)
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
