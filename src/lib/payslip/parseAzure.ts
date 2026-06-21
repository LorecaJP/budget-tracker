import type { ParsedPayslip, PayslipDeduction } from './types'

// Azure Document Intelligence (prebuilt-layout) の analyzeResult から給与項目を抽出する。
// 実際の出力に合わせた実装:
//  - 内訳（基本給・各控除）は tables のセルから取る。ラベルの「真下（行+1・同列）」、
//    無ければ「右（同行・列+1）」に金額が入る構造。本文ではラベルと値が離れて並ぶため誤対応しやすい。
//  - 合計系（総支給額・差引支給額）は表の外にあるので本文（ラベル＋同一行/次行の数値）から取る。
//  - OCR はカンマを '.' と読むことがあるため、'.' と ',' の両方を桁区切りとして除去する。

function toNum(s: string): number | null {
  const n = parseInt(s.replace(/[.,，\s]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}
function isNumeric(s: string): boolean {
  return /^[\d.,，\s]+$/.test(s.trim()) && /\d/.test(s)
}

// 表セルから「ラベル → 金額」のマップを作る。
function tableValueMap(ar: any): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of ar?.tables ?? []) {
    const rc: number = t.rowCount ?? 0
    const cc: number = t.columnCount ?? 0
    const grid: string[][] = Array.from({ length: rc }, () => Array<string>(cc).fill(''))
    for (const c of t.cells ?? []) {
      const r: number = c.rowIndex ?? 0
      const col: number = c.columnIndex ?? 0
      if (r < rc && col < cc) grid[r][col] = String(c.content ?? '').replace(/\s+/g, ' ').trim()
    }
    for (let r = 0; r < rc; r++) {
      for (let col = 0; col < cc; col++) {
        const label = grid[r][col]
        if (!label || isNumeric(label)) continue
        const below = r + 1 < rc ? grid[r + 1][col] : ''
        const right = col + 1 < cc ? grid[r][col + 1] : ''
        const valStr = isNumeric(below) ? below : isNumeric(right) ? right : ''
        if (valStr) {
          const v = toNum(valStr)
          if (v != null && !map.has(label)) map.set(label, v)
        }
      }
    }
  }
  return map
}

// 本文から「ラベル＋値」を探す（同一行末尾の数値、または次行の数値）。合計系に使う。
function contentNumber(lines: string[], label: string): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(label)) {
      const m = lines[i].match(/([\d][\d.,，]*)\s*$/)
      if (m) { const v = toNum(m[1]); if (v != null) return v }
      if (i + 1 < lines.length && isNumeric(lines[i + 1])) return toNum(lines[i + 1])
    }
  }
  return null
}

function findInMap(map: Map<string, number>, keyword: string): number | null {
  for (const [k, v] of map) if (k.includes(keyword)) return v
  return null
}

// 和暦の支給日 → 西暦 'YYYY-MM-DD'。令和は省略されることがある（賞与明細）ので
// 1〜2桁の年は令和（2018+N）とみなす。支給日付近を優先し、改行をまたぐ並びにも対応。
function eraDate(text: string): string | null {
  const m = text.match(/支給日[\s\S]{0,12}?(?:令和\s*)?(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
    ?? text.match(/(?:令和\s*)?(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (!m) return null
  let y = Number(m[1])
  if (y < 100) y = 2018 + y
  return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

export function parseAzureLayout(ar: any): ParsedPayslip {
  const content: string = ar?.content ?? ''
  const lines = content.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
  const tmap = tableValueMap(ar)

  const isBonus = /賞与/.test(content)
  const person = /優樹/.test(content) ? 'ゆうき' : /絵巳/.test(content) ? 'えみ' : null

  // 総支給（給料）/ 賞与支給総額（賞与）。本文優先、無ければ表から。
  const gross = contentNumber(lines, '総支給額') ?? contentNumber(lines, '賞与支給総額')
    ?? contentNumber(lines, '支給合計') ?? findInMap(tmap, '総支給') ?? findInMap(tmap, '賞与')
  // 差引支給額は本文で値が隣接しないことがある（賞与）ので表からも拾う
  const net = contentNumber(lines, '差引支給額') ?? contentNumber(lines, '振込支給額') ?? findInMap(tmap, '差引支給額')

  // 内訳は表セルから（小計の 社会保険料計・課税対象額・控除合計 は拾わない）
  const dedDefs: { label: string; keys: string[] }[] = [
    { label: '健康保険', keys: ['健康保険'] },
    { label: '厚生年金', keys: ['厚生年金'] },
    { label: '雇用保険', keys: ['雇用保険'] },
    { label: '住民税', keys: ['住民税'] },
    { label: '所得税', keys: ['算出所得税', '所得税'] },
  ]
  const deductions: PayslipDeduction[] = []
  for (const d of dedDefs) {
    let amt: number | null = null
    for (const k of d.keys) { amt = findInMap(tmap, k); if (amt != null) break }
    if (amt && amt > 0) deductions.push({ label: d.label, amount: amt })
  }

  const incomeCategory = isBonus ? 'ボーナス'
    : person === 'ゆうき' ? 'ゆうき給料' : person === 'えみ' ? 'えみ給料' : null

  return {
    format: 'azure-layout',
    kind: isBonus ? 'bonus' : 'salary',
    person,
    incomeCategory,
    payDate: eraDate(content),
    periodLabel: isBonus ? '賞与' : ((content.match(/令和\s*\d+\s*年\s*\d+\s*月度/) ?? [])[0]?.replace(/\s/g, '') ?? null),
    gross,
    net,
    deductions,
    base: findInMap(tmap, '基本給'),
    commute: findInMap(tmap, '通勤'),
  }
}
