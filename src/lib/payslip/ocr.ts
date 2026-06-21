import { supabase } from '../supabase'
import type { ParsedPayslip } from './types'
import { parseAzureLayout } from './parseAzure'

// スキャン明細の画像を Edge Function (payslip-ocr) 経由で Azure に解析させ、
// 給与項目へパースして返す。Azure のキーは Edge Function 側だけが持つ。
export async function ocrPayslipImage(image: Blob): Promise<ParsedPayslip> {
  const { data, error } = await supabase.functions.invoke('payslip-ocr', { body: image })
  if (error) throw new Error(await humanizeError(error))
  if (data?.error) throw new Error(String(data.error))
  if (!data?.analyzeResult) throw new Error('OCR結果が空でした')
  return parseAzureLayout(data.analyzeResult)
}

// supabase-js は非2xx応答だと汎用メッセージ（"Edge Function returned a non-2xx
// status code"）しか返さない。可能なら Edge Function の応答ボディ({error, detail})を
// 読み、Azure が返した実際の理由（HTTPコード等）を表示する。接頭辞は呼び出し側が付ける。
async function humanizeError(e: unknown): Promise<string> {
  const ctx = (e as { context?: unknown }).context
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json()
      if (body?.error) {
        const d = body.detail
        const detail = typeof d === 'string' ? d : d ? JSON.stringify(d) : ''
        return String(body.error) + (detail ? '：' + detail.slice(0, 300) : '')
      }
    } catch { /* JSON でなければ無視 */ }
    return `OCRサーバーエラー (HTTP ${ctx.status})`
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/not found|404|failed to send|fetch/i.test(msg)) {
    return 'OCR機能(payslip-ocr)が未デプロイか未設定です。Azureの設定とEdge Functionのデプロイ後に利用できます。'
  }
  return msg
}
