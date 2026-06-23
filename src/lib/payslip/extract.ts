// legacy ビルドを使う（互換性のため）。
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
// ワーカーは Vite の ?worker で「バンドル」して生成する。?url で生URLを渡すと、
// ワーカー内部の動的 import()/import.meta.url が解決できず Safari 等で
// "Importing a module script failed" になるため、workerPort 方式にする。
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

// Safari は ReadableStream の async iterator（for await...of）を未実装。
// pdf.js の getTextContent がこれを使うため、無ければ reader API で補完する。
if (typeof ReadableStream !== 'undefined') {
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>
  if (typeof proto[Symbol.asyncIterator] !== 'function') {
    proto[Symbol.asyncIterator] = function (this: ReadableStream) {
      const reader = this.getReader()
      return {
        next: () => reader.read(),
        return(value: unknown) { reader.releaseLock(); return Promise.resolve({ value, done: true }) },
        [Symbol.asyncIterator]() { return this },
      }
    }
  }
}

export interface ExtractResult {
  text: string
  hasTextLayer: boolean   // テキスト層があるか（false ならスキャン画像＝OCRが必要）
}

// 日本語PDF（CIDフォント）のテキスト抽出には CMap が必須。vite-plugin-static-copy で
// dist/cmaps/ に配信し、base path 付きで渡す（渡さないと半角ｶﾅ等が空になる＝楽天明細が読めない）。
const CMAP_URL = `${import.meta.env.BASE_URL}cmaps/`
const PDF_OPTS = { cMapUrl: CMAP_URL, cMapPacked: true }

// PDF の1ページ目からテキストを抽出する。
export async function extractPdfText(file: File): Promise<ExtractResult> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data, ...PDF_OPTS })
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

// 全ページのテキストを「行」単位で復元する（表のPDF＝楽天カード明細など用）。
// pdf.js の getTextContent は位置つきの断片を返すので、Y座標でグルーピングして
// 同じ行の断片を X 順に連結し、視覚的な行を組み立てる。
export async function extractPdfRows(file: File): Promise<{ rows: string[]; text: string }> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data, ...PDF_OPTS })
  try {
    const doc = await task.promise
    const rows: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      const buckets: { y: number; cells: { x: number; s: string }[] }[] = []
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue
        const tr = (it as unknown as { transform: number[] }).transform
        const x = tr[4], y = tr[5]
        let b = buckets.find(bk => Math.abs(bk.y - y) <= 3)
        if (!b) { b = { y, cells: [] }; buckets.push(b) }
        b.cells.push({ x, s: it.str })
      }
      buckets.sort((a, b) => b.y - a.y)   // 上から下へ（Y降順）
      for (const b of buckets) {
        rows.push(b.cells.sort((a, b) => a.x - b.x).map(c => c.s).join(' '))
      }
    }
    return { rows, text: rows.join('\n') }
  } finally {
    task.destroy()
  }
}

// スキャンPDFの1ページ目を JPEG 画像（Blob）に変換する（クラウドOCRへ送る用）。
// Azure Document Intelligence の無料枠(F0)は1ファイル最大4MB。CamScanner 等の高解像度
// 写真スキャンを PNG で出すと容易に4MBを超えて Azure に弾かれる（非2xx）ため、
// (1) 大きい元PDFは目標幅へ縮小し、(2) JPEG で出力、(3) 4MB未満に収まるよう品質を自動調整する。
export async function renderPdfFirstPage(file: File, targetWidth = 2200): Promise<Blob> {
  const data = new Uint8Array(await file.arrayBuffer())
  const task = pdfjs.getDocument({ data, ...PDF_OPTS })
  try {
    const doc = await task.promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    // 目標幅(約2200px)に合わせる。元が大きい(高解像度写真)PDFは縮小し、
    // 元が小さいPDFは最大3倍まで拡大して文字を鮮明にする。
    const scale = Math.min(3, targetWidth / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, viewport }).promise
    const MAX_BYTES = 3.8 * 1024 * 1024   // Azure F0 の4MB上限に対する安全圏
    let out: Blob | null = null
    for (const q of [0.85, 0.72, 0.6, 0.45]) {
      out = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('画像化に失敗しました'))), 'image/jpeg', q))
      if (out.size <= MAX_BYTES) break
    }
    return out as Blob
  } finally {
    task.destroy()
  }
}
