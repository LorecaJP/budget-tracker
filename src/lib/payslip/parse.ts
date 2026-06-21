import type { ParsedPayslip, PayslipDeduction } from './types'

// pdf.js が出力する給与明細テキストから項目を抽出する。
// テキストは「ラベル行 → 値行」の並びで、重複行や空行が混ざる前提でロバストに拾う。

function toNum(s: string): number | null {
  const n = parseInt(s.replace(/[,，\s]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

export function parsePayslipText(text: string): ParsedPayslip {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  const numRe = /^[\d,，]+$/

  // ラベルの直後（数行以内）に現れる最初の数値を返す
  const numberAfter = (label: string): number | null => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === label || lines[i].startsWith(label)) {
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          if (numRe.test(lines[j])) return toNum(lines[j])
        }
      }
    }
    return null
  }

  let payDate: string | null = null
  let periodLabel: string | null = null
  for (const l of lines) {
    const m = l.match(/支給日[：:]\s*(\d{4})（[^）]*）年(\d{1,2})月(\d{1,2})日/)
    if (m) payDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    const p = l.match(/(\d{4})（[^）]*）年(\d{1,2})月分/)
    if (p && !periodLabel) periodLabel = `${p[1]}年${p[2].padStart(2, '0')}月分`
  }

  const person = /絵巳/.test(text) ? 'えみ' : /優樹/.test(text) ? 'ゆうき' : null
  const incomeCategory = person === 'えみ' ? 'えみ給料' : person === 'ゆうき' ? 'ゆうき給料' : null

  const gross = numberAfter('支給合計') ?? numberAfter('総支給額')
  const net = numberAfter('振込支給額') ?? numberAfter('差引支給額')
  const totalDeduction = numberAfter('控除合計') ?? 0

  // この様式は控除の内訳を持たない（控除合計のみ）。0より大きければ概算1件として残す。
  const deductions: PayslipDeduction[] = totalDeduction > 0 ? [{ label: '控除', amount: totalDeduction }] : []

  return {
    format: /サーティーンストラット/.test(text) ? 'thirteenstrut' : 'generic',
    kind: 'salary',
    person,
    incomeCategory,
    payDate,
    periodLabel,
    gross,
    net,
    deductions,
    base: numberAfter('基本給'),
    commute: numberAfter('通勤手当'),
  }
}
