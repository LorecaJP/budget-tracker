<script lang="ts">
  // えみのシフト入力 → 就労月ごとの見込み（時間×時給・手動上書き可）。
  // 支給は「就労月の翌月末」なので、pay-month p の見込みは work-month(p-1) のシフトから算出。
  // 実際の給料が入った月（received[p-1]）は見込みを 0 にして二重計上しない。
  import { yen, ymd } from '../lib/month'
  import { listShifts, upsertShift, deleteShift, listFuyouOverrides, setFuyouOverride,
           type Shift, type FuyouOverride } from '../lib/db'

  let { year, wage, received, onestimate }: {
    year: number; wage: number; received: boolean[]; onestimate: (total: number) => void
  } = $props()

  let shifts = $state<Shift[]>([])
  let overrides = $state<FuyouOverride[]>([])
  let loading = $state(true)
  let showAdd = $state(false)
  let openM = $state<number | null>(null)

  let fDate = $state(ymd(new Date()))
  let fStart = $state('09:00')
  let fEnd = $state('17:00')
  let fBreak = $state(60)
  let saving = $state(false)

  let editM = $state<string | null>(null)
  let editVal = $state(0)

  const pad = (n: number) => String(n).padStart(2, '0')
  function toMin(t: string) { const [h, m] = (t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  function minToHHMM(m: number) { return `${pad(Math.floor(m / 60))}:${pad(m % 60)}` }
  function workMonthOfPay(p: number) { return p === 1 ? `${year - 1}-12` : `${year}-${pad(p - 1)}` }
  function hoursOf(s: Shift) { return Math.max(0, (s.end_min - s.start_min) - (s.break_min ?? 0)) / 60 }
  function fmtH(h: number) { return h.toFixed(1).replace(/\.0$/, '') }

  async function load() {
    loading = true
    shifts = await listShifts(`${year - 1}-12-01`, `${year}-12-01`)
    overrides = await listFuyouOverrides()
    loading = false
  }
  $effect(() => { void year; load() })

  // pay-month(1..12) ごとに集計
  const months = $derived.by(() =>
    Array.from({ length: 12 }, (_, i) => {
      const p = i + 1
      const wm = workMonthOfPay(p)
      const list = shifts.filter(s => s.work_date.slice(0, 7) === wm)
      const hours = list.reduce((s, sh) => s + hoursOf(sh), 0)
      const computed = Math.round(hours * wage)
      const ov = overrides.find(o => o.work_month === wm)?.amount ?? null
      const est = ov ?? computed
      const paid = received?.[p - 1] ?? false
      return { p, wm, list, hours, computed, ov, est, paid, active: paid ? 0 : est, workLabel: Number(wm.slice(5, 7)) }
    })
  )
  const estimateTotal = $derived(months.reduce((s, m) => s + m.active, 0))
  $effect(() => { onestimate(estimateTotal) })
  const planned = $derived(months.filter(m => m.list.length > 0 || m.ov != null))

  async function addShift() {
    const sm = toMin(fStart), em = toMin(fEnd)
    if (!fDate || em <= sm) return
    saving = true
    await upsertShift({ work_date: fDate, start_min: sm, end_min: em, break_min: Math.max(0, fBreak || 0), memo: '' })
    saving = false; showAdd = false
    await load()
  }
  async function removeShift(id?: string) { if (id) { await deleteShift(id); await load() } }
  function startEdit(wm: string, cur: number) { editM = wm; editVal = cur }
  async function saveOverride(wm: string) { await setFuyouOverride(wm, editVal); editM = null; await load() }
  async function clearOverride(wm: string) { await setFuyouOverride(wm, null); editM = null; await load() }
</script>

<section class="card">
  <div class="card-label">シフト・見込み</div>
  <p class="sp-lead">確定したシフトを入れると <strong>時間 × 時給 ＝ 見込み</strong> として上の「あと働ける」に反映されます（就労した月の<strong>翌月末</strong>が支給）。残業・早上がりは「金額を手動で直す」で調整できます。</p>

  {#if !showAdd}
    <button class="primary sp-add" onclick={() => showAdd = true}>＋ シフトを追加</button>
  {:else}
    <div class="shift-form">
      <label class="field"><span>就労日</span><input type="date" bind:value={fDate} /></label>
      <label class="field"><span>開始</span><input type="time" bind:value={fStart} /></label>
      <label class="field"><span>終了</span><input type="time" bind:value={fEnd} /></label>
      <label class="field"><span>休憩(分)</span><input type="number" min="0" step="5" bind:value={fBreak} /></label>
    </div>
    <div class="sp-actions">
      <button class="primary" onclick={addShift} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
      <button class="link" onclick={() => (showAdd = false)}>キャンセル</button>
    </div>
  {/if}

  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if planned.length === 0}
    <p class="hint">まだシフトがありません。「＋ シフトを追加」で予定を入れると、見込みが出ます。</p>
  {:else}
    <ul class="tx-list">
      {#each planned as m (m.p)}
        <li class="tx-row sp-row" onclick={() => (openM = openM === m.p ? null : m.p)}>
          <div class="tx-main">
            <span class="tx-name">{m.p}月支給<span class="sp-tag {m.paid ? 'paid' : 'est'}">{m.paid ? '受給済み' : '見込み'}</span></span>
            <span class="tx-sub">{m.workLabel}月就労 · {fmtH(m.hours)}h{m.ov != null ? ' · 手動' : ''}</span>
          </div>
          <span class="tx-amt">{m.paid ? '—' : yen(m.est)}</span>
        </li>
        {#if openM === m.p}
          <li class="sp-detail">
            {#if m.list.length}
              {#each m.list as sh (sh.id)}
                <div class="sp-shift">
                  <span>{sh.work_date.slice(5).replace('-', '/')} {minToHHMM(sh.start_min)}–{minToHHMM(sh.end_min)}{sh.break_min ? `（休${sh.break_min}分）` : ''} · {fmtH(hoursOf(sh))}h</span>
                  <button class="link neg" onclick={() => removeShift(sh.id)}>削除</button>
                </div>
              {/each}
            {:else}
              <p class="hint">この月のシフトは未入力（手動の見込みのみ）。</p>
            {/if}
            {#if editM === m.wm}
              <div class="sp-ov">
                <input type="number" min="0" step="1000" bind:value={editVal} />
                <button class="primary" onclick={() => saveOverride(m.wm)}>保存</button>
                <button class="link" onclick={() => clearOverride(m.wm)}>自動に戻す</button>
              </div>
            {:else}
              <div class="sp-ov">
                <span class="sp-ovnote">見込み {yen(m.est)}{m.ov != null ? '（手動）' : `（自動：${fmtH(m.hours)}h × ¥${wage.toLocaleString('ja-JP')}）`}</span>
                {#if !m.paid}<button class="link" onclick={() => startEdit(m.wm, m.est)}>金額を手動で直す</button>{/if}
              </div>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
    <div class="fy-kv sp-total"><span class="k">見込み合計（未受給ぶん）</span><span class="v">{yen(estimateTotal)}</span></div>
  {/if}
</section>
