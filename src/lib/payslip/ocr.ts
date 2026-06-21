import { supabase } from '../supabase'
import type { ParsedPayslip } from './types'
import { parseAzureLayout } from './parseAzure'

// スキャン明細の画像を Edge Function (payslip-ocr) 経由で Azure に解析させ、
// 給与項目へパースして返す。Azure のキーは Edge Function 側だけが持つ。
export async function ocrPayslipImage(image: Blob): Promise<ParsedPayslip> {
  const { data, error } = await supabase.functions.invoke('payslip-ocr', { body: image })
  if (error) throw new Error(humanizeError(error))
  if (data?.error) throw new Error(String(data.error))
  if (!data?.analyzeResult) throw new Error('OCR結果が空でした')
  return parseAzureLayout(data.analyzeResult)
}

function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/not found|404|failed to send|fetch/i.test(msg)) {
    return 'OCR機能(payslip-ocr)が未デプロイか未設定です。Azureの設定とEdge Functionのデプロイ後に利用できます。'
  }
  return 'OCRに失敗しました：' + msg
}
