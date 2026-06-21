import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// pdf.js のワーカー（Vite が ?url で同梱）
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface ExtractResult {
  text: string
  hasTextLayer: boolean   // テキスト層があるか（false ならスキャン画像＝OCRが必要）
}

// PDF の1ページ目からテキストを抽出する。
export async function extractPdfText(file: File): Promise<ExtractResult> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const tc = await page.getTextContent()
    const text = tc.items.map(it => ('str' in it ? it.str : '')).join('\n')
    return { text, hasTextLayer: text.replace(/\s/g, '').length > 50 }
  } finally {
    task.destroy()
  }
}
