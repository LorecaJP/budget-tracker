// Google カレンダー連携（方式2 ワンタップ同期）。
// Google Identity Services（GIS）のトークンクライアントで Calendar スコープの
// access token を取得し、Calendar API でシフトをイベント登録/更新する。
//
// CLIENT_ID は OAuth「ウェブアプリ」クライアントID（公開してよい・秘密ではない）。
// オーナーが Google Cloud で発行して下の定数に差し替える。未設定なら連携ボタンは
// 案内メッセージのみ（gcalConfigured() が false）。
const CLIENT_ID = '' // 例: '1234567890-abcdefg.apps.googleusercontent.com'
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TITLE = 'バイト'

export function gcalConfigured(): boolean {
  return CLIENT_ID.endsWith('.apps.googleusercontent.com')
}

// GIS スクリプトを必要時に動的ロード（全員には読み込ませない）
let gisReady: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (gisReady) return gisReady
  gisReady = new Promise<void>((resolve, reject) => {
    const w = window as unknown as { google?: { accounts?: { oauth2?: unknown } } }
    if (w.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Googleの読み込みに失敗しました'))
    document.head.appendChild(s)
  })
  return gisReady
}

// アクセストークン（短命）をキャッシュ。初回/失効時のみ Google の同意ポップアップが出る。
let token: { value: string; exp: number } | null = null
async function getToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value
  await loadGis()
  const oauth2 = (window as any).google.accounts.oauth2
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error_description || r.error))
        token = { value: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }
        resolve(r.access_token)
      },
    })
    client.requestAccessToken()
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
// シフトIDから決定的なイベントID（[a-v0-9] のみ・5〜1024文字）を作る＝再登録で重複しない
const eid = (shiftId: string) => 'sh' + shiftId.replace(/-/g, '').toLowerCase()

export interface CalShift { id: string; work_date: string; start_min: number; end_min: number }

function body(s: CalShift) {
  return {
    summary: TITLE,
    start: { dateTime: `${s.work_date}T${hhmm(s.start_min)}:00`, timeZone: 'Asia/Tokyo' },
    end: { dateTime: `${s.work_date}T${hhmm(s.end_min)}:00`, timeZone: 'Asia/Tokyo' },
  }
}

// シフト群を Googleカレンダーへ登録/更新。決定的IDなので再実行しても重複しない。
export async function syncShifts(shifts: CalShift[]): Promise<{ ok: number }> {
  const t = await getToken()
  const headers = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
  let ok = 0
  for (const s of shifts) {
    const id = eid(s.id)
    // まず更新(PUT)、無ければ作成(POST)
    let res = await fetch(`${EVENTS}/${id}`, { method: 'PUT', headers, body: JSON.stringify(body(s)) })
    if (res.status === 404 || res.status === 410) {
      res = await fetch(EVENTS, { method: 'POST', headers, body: JSON.stringify({ id, ...body(s) }) })
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`登録失敗 (${res.status}) ${txt.slice(0, 120)}`)
    }
    ok++
  }
  return { ok }
}
