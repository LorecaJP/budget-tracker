// 口座振替の「引落日が休日なら翌営業日」を判定するためのユーティリティ。
// 日本の祝日は自動計算（春分/秋分・振替休日）が面倒なので年ごとに直書きする。
// ※年が変わったら下の一覧に追記すること（無くても土日は必ず補正される）。
const JP_HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
  // 2027
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23',
])

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isBusinessDay(d: Date): boolean {
  const wd = d.getDay()
  if (wd === 0 || wd === 6) return false       // 日・土
  return !JP_HOLIDAYS.has(iso(d))
}

// その日が土日祝なら翌営業日へ送る
export function nextBusinessDay(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  while (!isBusinessDay(x)) x.setDate(x.getDate() + 1)
  return x
}

// 毎月 dueDay 引落の「次回の引落日」（今日以降・休日は翌営業日補正）を ISO 文字列で返す
export function nextMonthlyDue(dueDay: number, from: Date = new Date()): string {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < 14; i++) {
    const y = from.getFullYear(), m = from.getMonth() + i
    const dim = new Date(y, m + 1, 0).getDate()           // その月の日数
    const due = nextBusinessDay(new Date(y, m, Math.min(dueDay, dim)))
    if (due >= today) return iso(due)
  }
  return iso(today)
}
