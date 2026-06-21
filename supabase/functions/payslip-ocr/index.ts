// 給与明細スキャン画像を Azure Document Intelligence (prebuilt-layout) で解析する Edge Function。
//
// クライアントから画像のバイト列（POST body）を受け取り、Azure を呼び出して
// analyzeResult（content + tables）を JSON で返す。Azure のキーはここ（サーバー側）
// だけが持ち、クライアントには出さない。
//
// 必要シークレット（Supabase: Edge Functions の Secrets に登録）:
//   AZURE_DI_ENDPOINT   例: https://<name>.cognitiveservices.azure.com
//   AZURE_DI_KEY        Document Intelligence のキー
// 任意:
//   AZURE_DI_MODEL        既定 'prebuilt-layout'
//   AZURE_DI_API_VERSION  既定 '2024-11-30'
//
// JWT 検証（既定で有効）により、ログイン済みユーザーのみ呼び出せる。

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const endpoint = Deno.env.get('AZURE_DI_ENDPOINT')
  const key = Deno.env.get('AZURE_DI_KEY')
  if (!endpoint || !key) {
    return json({ error: 'Azure 未設定です（AZURE_DI_ENDPOINT / AZURE_DI_KEY を Secrets に登録してください）' }, 500)
  }
  const model = Deno.env.get('AZURE_DI_MODEL') ?? 'prebuilt-layout'
  const apiVersion = Deno.env.get('AZURE_DI_API_VERSION') ?? '2024-11-30'

  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength === 0) return json({ error: '画像データがありません' }, 400)

  const base = endpoint.replace(/\/+$/, '')
  const analyzeUrl = `${base}/documentintelligence/documentModels/${model}:analyze?api-version=${apiVersion}`

  // 1) 解析開始（202 + Operation-Location）
  const start = await fetch(analyzeUrl, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  if (start.status !== 202) {
    const detail = (await start.text()).slice(0, 800)
    return json({ error: `Azure analyze 失敗 (HTTP ${start.status})`, detail }, 502)
  }
  const opLoc = start.headers.get('operation-location')
  if (!opLoc) return json({ error: 'Operation-Location ヘッダがありません' }, 502)

  // 2) 完了までポーリング（最大 ~40 秒）
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const poll = await fetch(opLoc, { headers: { 'Ocp-Apim-Subscription-Key': key } })
    const data = await poll.json()
    if (data.status === 'succeeded') return json({ analyzeResult: data.analyzeResult })
    if (data.status === 'failed') return json({ error: 'Azure 解析に失敗しました', detail: data.error }, 502)
  }
  return json({ error: 'Azure 解析がタイムアウトしました' }, 504)
})
