<script lang="ts">
  // 就労月ごとの見込み（時間×時給・手動上書き可）のサマリ。入力はカレンダー(ShiftCalendar)へ。
  // 支給月 p の見込みは work-month(p-1) のシフトから算出。実給与が入った月は見込みを0（二重計上回避）。
  import { yen } from '../lib/month'
  import { listShifts, listFuyouOverrides, setFuyouOverride, type Shift, type FuyouOverride } from '../lib/db'
  import ShiftCalendar from './ShiftCalendar.svelte'

  let { year, wage, received, onestimate }: {
    year: number; wage: number; received: boolean[]; onestimate: (total: number) => void
  } = $props()

  let shifts = $state<Shift[]>([])
  let overrides = $state<FuyouOverride[]>([])
  let loading = $state(true)
  let calOpen = $state(false)
  let openM = $state<number | null>(null)
  let editM = $state<string | null>(null)
  let editVal = $state(0)

  const pad = (n: number) => String(n).padStart(2, '0')
  function minHHMM(v: number) { return `${pad(Math.floor(v / 60))}:${pad(v % 60)}` }
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

  const months = $derived.by(() =>
    Array.from({ length: 12 }, (_, i) => {
      const p = i + 1, wm = workMonthOfPay(p)
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

  function startEdit(wm: string, cur: number) { editM = wm; editVal = cur }
  async function saveOverride(wm: string) { await setFuyouOverride(wm, editVal); editM = null; await load() }
  async function clearOverride(wm: string) { await setFuyouOverride(wm, null); editM = null; await load() }
</script>

<section class="card">
  <div class="card-label">シフト・見込み</div>
  <p class="sp-lead">シフトを入れると <strong>時間 × 時給 ＝ 見込み</strong> として上の「あと働ける」に反映されます（就労した月の<strong>翌月末</strong>が支給）。</p>
  <button class="primary sp-add" onclick={() => (calOpen = true)}>📅 カレンダーでシフトを入力</button>

  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if planned.length === 0}
    <p class="hint">まだシフトがありません。上のボタンからカレンダーで予定を入れると、見込みが出ます。</p>
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
                <div class="sp-shift"><span>{sh.work_date.slice(5).replace('-', '/')} {minHHMM(sh.start_min)}–{minHHMM(sh.end_min)}{sh.break_min ? `（休${sh.break_min}分）` : ''} · {fmtH(hoursOf(sh))}h</span></div>
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

{#if calOpen}
  <ShiftCalendar onclose={() => (calOpen = false)} onchange={load} />
{/if}
