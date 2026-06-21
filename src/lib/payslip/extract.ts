// legacy ビルドを使う（互換性のため）。
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
// ワーカーは Vite の ?worker で「バンドル」して生成する。?url で生URLを渡すと、
// ワーカー内部の動的 import()/import.meta.url が解決できず Safari 等で
// "Importing a module script failed" になるため、workerPort 方式にする。
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

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

// スキャンPDFの1ページ目を PNG 画像（Blob）に変換する（クラウドOCRへ送る用）。
export async function renderPdfFirstPage(file: File, targetWidth = 2200): Promise<Blob> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, Math.max(1, targetWidth / base.width))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('画像化に失敗しました'))), 'image/png'))
  } finally {
    task.destroy()
  }
}
