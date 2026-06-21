import type { ParsedPayslip, PayslipDeduction } from './types'

// Azure Document Intelligence (prebuilt-layout) の analyzeResult から給与項目を抽出する。
// ⚠️ 実際の Azure 出力を1回確認してから精緻化する前提のベストエフォート版。
// 取りこぼし・誤りはレビュー画面で人が修正できる（自動保存はしない）。

function toNum(s: string): number | null {
  // OCR はカンマを '.' と誤読しがちなので両方を桁区切りとして除去
  const n = parseInt(s.replace(/[.,，\s]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

// analyzeResult から走査用のテキスト行を集める（本文＋表セル）
function collectLines(ar: any): string[] {
  const lines: string[] = []
  if (typeof ar?.content === 'string') {
    for (const l of ar.content.split(/\r?\n/)) { const t = l.trim(); if (t) lines.push(t) }
  }
  for (const t of ar?.tables ?? []) {
    for (const c of t?.cells ?? []) {
      const t2 = String(c?.content ?? '').trim()
      if (t2) lines.push(t2)
    }
  }
  return lines
}

const numRe = /^[\d.,，]+$/
function numberNear(lines: string[], labels: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (labels.some(lb => lines[i].includes(lb))) {
      // 同じ行に数値が含まれていればそれを優先
      const inline = lines[i].match(/([\d][\d.,，]*)\s*$/)
      if (inline) { const v = toNum(inline[1]); if (v != null) return v }
      // 後続の数行から最初の数値
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        if (numRe.test(lines[j])) return toNum(lines[j])
      }
    }
  }
  return null
}

// 和暦（令和）→ 西暦。令和N年 = 2018 + N。
function wareki(lines: string[]): string | null {
  const text = lines.join('\n')
  // 「支給日 … 令和N年M月D日」を優先、なければ最初の令和日付
  const around = text.match(/支給日[^\n]*?令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/)
  const m = around ?? text.match(/令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/)
  if (!m) return null
  const y = 2018 + Number(m[1])
  return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

export function parseAzureLayout(analyzeResult: any): ParsedPayslip {
  const lines = collectLines(analyzeResult)
  const text = lines.join('\n')

  const person = /優樹/.test(text) ? 'ゆうき' : /絵巳/.test(text) ? 'えみ' : null
  const incomeCategory = person === 'ゆうき' ? 'ゆうき給料' : person === 'えみ' ? 'えみ給料' : null

  const gross = numberNear(lines, ['総支給額', '支給合計'])
  const net = numberNear(lines, ['差引支給額', '振込支給額'])

  // 控除の内訳。社会保険料計（小計）と控除合計（総計）は重複計上を避けて除外。
  const dedDefs: { label: string; keys: string[] }[] = [
    { label: '健康保険', keys: ['健康保険'] },
    { label: '厚生年金', keys: ['厚生年金'] },
    { label: '雇用保険', keys: ['雇用保険'] },
    { label: '住民税', keys: ['住民税'] },
    { label: '所得税', keys: ['算出所得税', '所得税'] },
  ]
  const deductions: PayslipDeduction[] = []
  for (const d of dedDefs) {
    const amt = numberNear(lines, d.keys)
    if (amt && amt > 0) deductions.push({ label: d.label, amount: amt })
  }

  return {
    format: 'azure-layout',
    person,
    incomeCategory,
    payDate: wareki(lines),
    periodLabel: (text.match(/令和\s*\d+\s*年\s*\d+\s*月度/) ?? [])[0]?.replace(/\s/g, '') ?? null,
    gross,
    net,
    deductions,
    base: numberNear(lines, ['基本給']),
    commute: numberNear(lines, ['通勤費', '通勤手当']),
  }
}
