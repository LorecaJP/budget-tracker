// iPhone純正カレンダーへの追加（.ics を生成 → 開くと iOS の「カレンダーに追加」が起動）。
// OAuth もサーバも不要。時刻は TZ 指定なしのフローティング＝閲覧端末のローカル時刻（JST想定）。
export interface IcsShift { id: string; work_date: string; start_min: number; end_min: number }

const pad = (n: number) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' + 分 → 'YYYYMMDDTHHMMSS'（フローティング・ローカル時刻）
function dt(workDate: string, min: number): string {
  const [y, m, d] = workDate.split('-')
  return `${y}${m}${d}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`
}
// DTSTAMP は UTC（YYYYMMDDTHHMMSSZ）
function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}
function uid(shiftId: string): string { return 'sh' + shiftId.replace(/-/g, '') + '@yutori' }

export function buildIcs(shifts: IcsShift[], title = 'バイト'): string {
  const now = stamp()
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//yutori//shifts//JA', 'CALSCALE:GREGORIAN']
  for (const s of shifts) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid(s.id)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${dt(s.work_date, s.start_min)}`,
      `DTEND:${dt(s.work_date, s.end_min)}`,
      `SUMMARY:${title}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// .ics をダウンロード/オープン → iOS が「"カレンダー"に追加（すべて追加）」を表示。
export function openIcs(shifts: IcsShift[], filename = 'yutori-shifts.ics'): void {
  const blob = new Blob([buildIcs(shifts)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 1500)
}
