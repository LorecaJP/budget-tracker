<script lang="ts">
  // 月カレンダー（ボトムシート）。日付をタップして 1 日 1 シフトを登録/編集/削除。
  // 休憩は「労働(開始〜終了)が6時間超のときだけ自動90分／ちょうど6時間以下は休憩なし」。
  import { listShifts, upsertShift, deleteShift, type Shift } from '../lib/db'

  let { onclose, onchange }: { onclose: () => void; onchange: () => void } = $props()

  const now = new Date()
  let y = $state(now.getFullYear())
  let m = $state(now.getMonth() + 1)
  let shifts = $state<Shift[]>([])
  let sel = $state<string | null>(null)
  let eStart = $state('09:00')
  let eEnd = $state('17:00')
  let eId = $state<string | undefined>(undefined)
  let busy = $state(false)

  const WD = ['日', '月', '火', '水', '木', '金', '土']
  const pad = (n: number) => String(n).padStart(2, '0')
  function toMin(t: string) { const [h, mm] = (t || '').split(':').map(Number); return (h || 0) * 60 + (mm || 0) }
  function minHHMM(v: number) { return `${pad(Math.floor(v / 60))}:${pad(v % 60)}` }
  // 休憩：労働(開始〜終了)が6時間(360分)を超えたら90分、ちょうど6時間以下は休憩なし。
  function breakFor(grossMin: number) { return grossMin > 360 ? 90 : 0 }
  function fmtH(h: number) { return h.toFixed(1).replace(/\.0$/, '') }

  const grossMin = $derived(toMin(eEnd) - toMin(eStart))
  const autoBreak = $derived(breakFor(grossMin))
  const netH = $derived(Math.max(0, (grossMin - autoBreak) / 60))

  async function load() {
    const start = `${y}-${pad(m)}-01`
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
    shifts = await listShifts(start, end)
  }
  $effect(() => { void y; void m; load() })

  // モーダル表示中は背景（扶養ページ）をスクロールさせない
  $effect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  })

  const cells = $derived.by(() => {
    const first = new Date(y, m - 1, 1).getDay()
    const days = new Date(y, m, 0).getDate()
    const arr: ({ d: number; date: string; shift?: Shift } | null)[] = []
    for (let i = 0; i < first; i++) arr.push(null)
    for (let d = 1; d <= days; d++) {
      const date = `${y}-${pad(m)}-${pad(d)}`
      arr.push({ d, date, shift: shifts.find(s => s.work_date === date) })
    }
    return arr
  })
  const monthHours = $derived(shifts.reduce((s, sh) => s + Math.max(0, ((sh.end_min - sh.start_min) - (sh.break_min ?? 0)) / 60), 0))

  function go(delta: number) {
    const idx = (y * 12 + (m - 1)) + delta
    y = Math.floor(idx / 12); m = (idx % 12) + 1; sel = null
  }
  function pick(date: string, shift?: Shift) {
    sel = date
    if (shift) { eId = shift.id; eStart = minHHMM(shift.start_min); eEnd = minHHMM(shift.end_min) }
    else { eId = undefined; eStart = '09:00'; eEnd = '17:00' }
  }
  // よく使うシフトを1タップで登録（開始/終了をセットしてそのまま保存）
  async function quick(start: string, end: string) {
    eStart = start; eEnd = end
    await save()
  }
  async function save() {
    if (!sel) return
    const sm = toMin(eStart), em = toMin(eEnd)
    if (em <= sm) return
    busy = true
    await upsertShift({ id: eId, work_date: sel, start_min: sm, end_min: em, break_min: breakFor(em - sm), memo: '' })
    await load(); onchange()
    eId = shifts.find(s => s.work_date === sel)?.id
    busy = false
  }
  async function remove() {
    if (!eId) return
    busy = true
    await deleteShift(eId)
    await load(); onchange(); sel = null
    busy = false
  }
</script>

<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="シフト">
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <button class="link" onclick={onclose}>閉じる</button>
      <span class="sheet-title">シフトを入力</span>
      <span style="width:48px"></span>
    </div>

    <div class="cal-nav">
      <button class="nav-btn" onclick={() => go(-1)} aria-label="前の月">‹</button>
      <span class="cal-title">{y}年{m}月</span>
      <button class="nav-btn" onclick={() => go(1)} aria-label="次の月">›</button>
    </div>

    <div class="cal-grid">
      {#each WD as w, i}
        <div class="cal-wd {i === 0 ? 'cal-sun' : ''} {i === 6 ? 'cal-sat' : ''}">{w}</div>
      {/each}
      {#each cells as c, i (i)}
        {#if c}
          <button class="cal-day {c.shift ? 'has' : ''} {sel === c.date ? 'sel' : ''}" onclick={() => pick(c.date, c.shift)}>
            <span class="cal-dnum">{c.d}</span>
            {#if c.shift}<span class="cal-dh">{fmtH(Math.max(0, ((c.shift.end_min - c.shift.start_min) - (c.shift.break_min ?? 0)) / 60))}h</span>{/if}
          </button>
        {:else}
          <span class="cal-day empty"></span>
        {/if}
      {/each}
    </div>

    {#if sel}
      <div class="cal-edit">
        <div class="cal-edit-head">
          <span>{Number(sel.slice(5, 7))}月{Number(sel.slice(8, 10))}日 {eId ? '（編集）' : '（新規）'}</span>
          {#if eId}<button class="cal-del" onclick={remove} disabled={busy}>削除</button>{/if}
        </div>
        <div class="cal-presets">
          <button class="cal-preset" onclick={() => quick('13:00', '20:30')} disabled={busy}>13:00〜20:30</button>
          <button class="cal-preset" onclick={() => quick('09:30', '17:00')} disabled={busy}>9:30〜17:00</button>
        </div>
        <div class="cal-times">
          <label class="field"><span>開始</span><input type="time" step="900" bind:value={eStart} /></label>
          <label class="field"><span>終了</span><input type="time" step="900" bind:value={eEnd} /></label>
        </div>
        <div class="cal-note">実働 {fmtH(netH)}h ・ {autoBreak > 0 ? `休憩${autoBreak}分（6時間超で自動）` : '休憩なし'}</div>
        <button class="primary cal-save" onclick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    {:else}
      <p class="hint cal-hint">日付をタップしてシフトを登録できます。</p>
    {/if}

    <div class="fy-kv cal-total"><span class="k">{m}月の合計シフト時間</span><span class="v">{fmtH(monthHours)}時間</span></div>
  </div>
</div>
