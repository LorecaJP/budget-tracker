// 給与明細PDFから抽出した内容（テキストPDF・将来のOCRで共通利用）
export interface PayslipDeduction {
  label: string        // '所得税' / '健康保険' など（カテゴリ名にマッチさせる）
  amount: number       // 円・整数
}

export interface ParsedPayslip {
  format: string                   // 'thirteenstrut' / 'generic' など
  kind: 'salary' | 'bonus'         // 給料 / 賞与（計上月の補正やカテゴリ分けに使う）
  person: string | null            // 'えみ' / 'ゆうき' / null
  incomeCategory: string | null    // 総支給を割り当てるカテゴリ名
  payDate: string | null           // 'YYYY-MM-DD'（支給日）
  periodLabel: string | null       // 例: '2026年04月分'（メモ用）
  gross: number | null             // 総支給 / 支給合計
  net: number | null               // 差引支給額 / 振込支給額
  deductions: PayslipDeduction[]   // 控除の内訳（tax区分の支出として記録）
  base: number | null              // 基本給（メモ用）
  commute: number | null           // 通勤手当（メモ用 / 扶養トラッカー：非課税なので税・106万には不算入）
  taxable: number | null           // 課税支給額（扶養トラッカー：103万手当・税の正しい基準）
  workMinutes: number | null       // 総労働時間（分。扶養トラッカー：週20時間判定の材料）
}
