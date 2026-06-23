// 楽天カードの「ご利用代金請求明細書」PDF（テキスト層あり）のパーサ。
// extractPdfRows で復元した行を1明細ずつ読み、店名→カテゴリを自動判定する。
// カテゴリは家計簿本体の区分とは別の「カード利用カテゴリ」。手直し可。

export interface RakutenItem {
  use_date: string   // 'YYYY-MM-DD'（利用日）
  merchant: string   // 利用店名（生の表記）
  amount: number     // 利用金額（円）
  person: string     // '本人' / '家族'
  category: string   // 自動判定（編集可）
}
export interface ParsedRakuten {
  statement_month: string   // 'YYYY-MM'（請求月）
  items: RakutenItem[]
  total: number
}

// 店名キーワード → カテゴリ。上から順に最初に一致したものを採用。
const RULES: [string, string[]][] = [
  ['食・カフェ', ['ｽﾀ-ﾊﾞﾂｸｽ', 'ｽﾀﾊﾞ', 'ﾊﾏｽｼ', 'はま寿司', 'ﾏｸﾄﾞﾅﾙﾄﾞ', 'マクドナルド', 'ｺﾅﾓﾝ', 'ｻ-ﾃｲﾜﾝ', 'ｷｽｲ', 'ｽｼﾛ', 'くら寿司', 'ｺﾒﾀﾞ', 'ﾄﾞﾄ-ﾙ', 'ﾌｱﾐﾘ-ﾏ-ﾄ', 'ファミリーマート', 'ｾﾌﾞﾝ', 'ﾛ-ｿﾝ', 'ローソン', 'ﾀﾘ-ｽﾞ', 'タリーズ', 'ｼﾞﾖﾘ-', 'ジョリー', '鎌倉パスタ', '壱番屋', 'ｻｲｾﾞﾘﾔ', 'サイゼ', 'ワタミ', 'UBER', 'EATS', 'ｼｴｲｸｼﾔﾂｸ', 'ﾏﾂｲｼﾔ']],
  ['娯楽・サブスク', ['DMM', 'APPLE', 'NINTENDO', 'ﾆﾝﾃﾝﾄﾞ', 'ｿﾆｰ', 'ﾌｰﾙｰ', 'フールー', 'SPOTIFY', 'ﾃﾞｲｽﾞﾆ', 'ｱｼｴﾂﾄ', 'アシェット', 'ｱｸﾞﾍｱ']],
  ['レジャー・旅行', ['ﾕﾆﾊﾞ-ｻﾙ', 'USJ', 'ｼﾈﾏ', 'ｴｲｶﾞ', 'ﾄﾗﾍﾞﾙ', 'じゃらん', 'ﾎﾃﾙ']],
  ['交通', ['ｺﾞ-', 'Ｓｕｉｃａ', 'Suica', 'ｷﾝﾃﾂ', 'ｷﾝｷﾆﾂﾎﾟﾝﾃﾂ', 'ｲﾖﾃﾂ', 'ﾀｸｼ', 'ＥＴＣ', 'ﾁﾕｳｼﾔ', 'ﾆﾂﾎﾟﾝﾕｳﾋﾞﾝ']],
  ['買い物', ['AMAZON', 'ｴﾃﾞｨｵﾝ', 'エディオン', 'ﾋﾔﾂｶﾃﾝ', 'ｲｵﾝ', 'ﾄﾞﾝｷ', 'ﾒｶﾞﾄﾞﾝ', 'ﾏﾂﾓﾄｷﾖｼ', 'ﾆﾄﾘ', 'ﾕﾆｸﾛ', 'ｼﾖﾂﾌﾟ', 'ﾒﾙｶﾘ', 'メルカリ', 'ｼﾏﾑﾗ', 'しまむら']],
  ['通信・公共', ['関西電力', '電気', 'ﾄﾞｺﾓ', 'ドコモ', 'ｶﾞｽ', '水道', '電力料金']],
  ['健康・会費', ['COSPA', 'ＣＯＳＰＡ', 'ｺｽﾊﾟ', 'ｼﾞﾑ', '会費', 'ｳｴﾙﾈｽ']],
  ['チャージ・電子マネー', ['ﾍﾟｲﾍﾟｲ', 'ペイペイ', 'PayPay', 'ﾁﾔ-ｼﾞ', 'ｷﾔﾂｼﾕ']],
]
export const RAKUTEN_CATEGORIES = [...RULES.map(r => r[0]), 'その他']

export function categorize(merchant: string): string {
  for (const [cat, kws] of RULES) for (const k of kws) if (merchant.includes(k)) return cat
  return 'その他'
}

const ROW = /^(\d{4})\/(\d{2})\/(\d{2})\s+(.+?)\s+(本人|家族)\*?\s+(.+)$/

export function parseRakuten(rows: string[], fullText: string): ParsedRakuten {
  // 請求月：「2026年01月ご請求金額」から
  let sm = ''
  const mm = fullText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*ご請求/)
  if (mm) sm = `${mm[1]}-${String(mm[2]).padStart(2, '0')}`

  const items: RakutenItem[] = []
  for (const raw of rows) {
    const m = raw.trim().match(ROW)
    if (!m) continue
    // 支払方法（◯回払い等）に数字が含まれるので「払い」の後ろから金額を拾う
    const rest = m[6].includes('払い') ? m[6].split('払い').slice(1).join('払い') : m[6]
    const nums = rest.match(/[\d,]+/g)
    if (!nums) continue
    const amount = parseInt(nums[0].replace(/[,，]/g, ''), 10)
    if (!amount || amount <= 0) continue
    const merchant = m[4].trim()
    items.push({
      use_date: `${m[1]}-${m[2]}-${m[3]}`,
      merchant, amount, person: m[5], category: categorize(merchant),
    })
  }
  const total = items.reduce((s, it) => s + it.amount, 0)
  return { statement_month: sm, items, total }
}
