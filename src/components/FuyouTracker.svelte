<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { getFuyouConfig, listEmiSalaryYear, listPayslipDetails, type FuyouConfig, type PayslipDetail } from '../lib/db'
  import type { Transaction } from '../lib/types'

  // 社会保険(106万)の月次トリガー目安：月8.8万円（参考表示）
  const SHAHO_MONTH_LINE = 88000
  const WEEKS_PER_MONTH = 52 / 12
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  const now = new Date()
  let year = $state(now.getFullYear())
  let cfg = $state<FuyouConfig>({ hourly_wage: 1180, year_cap: 1030000 })
  let txs = $state<Transaction[]>([])
  let details = $state<PayslipDetail[]>([])
  let loading = $state(true)

  async function load() {
    loading = true
    cfg = await getFuyouConfig()
    txs = await listEmiSalaryYear(year)
    details = await listPayslipDetails(year)
    loading = false
  }
  onMount(load)
  function go(d: number) { year += d; load() }

  // 総支給（取引）を暦月ごとに集計
  const grossM = $derived.by(() => {
    const a = new Array(12).fill(0) as number[]
    for (const t of txs) { const m = Number(t.date.slice(5, 7)); if (m >= 1 && m <= 12) a[m - 1] += t.amount }
    return a
  })
  // 明細の追加項目（課税支給額・通勤手当・総労働時間）を暦月ごとに集計
  const detM = $derived.by(() => {
    const a = Array.from({ length: 12 }, () => ({ taxable: null as number | null, commute: null as number | null, minutes: null as number | null }))
    for (const d of details) {
      const m = Number(d.pay_date.slice(5, 7)); if (m < 1 || m > 12) continue
      const c = a[m - 1]
      if (d.taxable != null) c.taxable = (c.taxable ?? 0) + d.taxable
      if (d.commute != null) c.commute = (c.commute ?? 0) + d.commute
      if (d.work_minutes != null) c.minutes = (c.minutes ?? 0) + d.work_minutes
    }
    return a
  })

  const cap = $derived(cfg.year_cap)
  const wage = $derived(cfg.hourly_wage)
  const grossYtd = $derived(grossM.reduce((s, n) => s + n, 0))
  // 課税支給額：月ごとに明細があればそれ、無ければ総支給でフォールバック（＝上限判定の基準）
  const taxableYtd = $derived(grossM.reduce((s, n, i) => s + (detM[i].taxable ?? n), 0))
  const commuteYtd = $derived(detM.reduce((s, c) => s + (c.commute ?? 0), 0))
  const minutesYtd = $derived(detM.reduce((s, c) => s + (c.minutes ?? 0), 0))
  const hasCommute = $derived(detM.some(c => c.commute != null))
  const monthsWithHours = $derived(detM.filter(c => c.minutes != null).length)
  const totalHours = $derived(minutesYtd / 60)
  const weeklyAvgHours = $derived(monthsWithHours > 0 ? (totalHours / monthsWithHours) / WEEKS_PER_MONTH : 0)

  // 上限判定は課税支給額ベース
  const base = $derived(taxableYtd)
  const over = $derived(base > cap)
  const overage = $derived(Math.max(0, base - cap))
  const remaining = $derived(Math.max(0, cap - base))
  const pct = $derived(cap > 0 ? Math.min(100, Math.round((base / cap) * 100)) : 0)
  const remainHours = $derived(wage > 0 ? Math.floor(remaining / wage) : 0)
  const paidMonths = $derived(grossM.filter(v => v > 0).length)
  const projected = $derived(paidMonths > 0 ? Math.round((base / paidMonths) * 12) : 0)
  const isThisYear = $derived(year === now.getFullYear())
</script>

<div class="screen">
  <div class="month-nav">
    <button class="nav-btn" onclick={() => go(-1)} aria-label="前の年">‹</button>
    <span class="month-title">{year}年（暦年）</span>
    <button class="nav-btn" onclick={() => go(1)} aria-label="次の年">›</button>
  </div>

  {#if loading}
    <p class="state">集計中…</p>
  {:else}
    <section class="card">
      <div class="card-label">えみ 扶養トラッカー（上限 {yen(cap)}）</div>
      <div class="fuyou-stats">
        <div class="fuyou-stat">
          <div class="fuyou-big {over ? 'neg' : 'pos'}">{over ? '−' + yen(overage) : yen(remaining)}</div>
          <div class="fuyou-cap">{over ? '超過した金額' : 'あと稼げる金額'}（課税）</div>
        </div>
        <div class="fuyou-stat">
          <div class="fuyou-big {over ? 'neg' : 'pos'}">約{remainHours.toLocaleString('ja-JP')}<span class="fuyou-unit">時間</span></div>
          <div class="fuyou-cap">あと働ける時間（時給{yen(wage)}）</div>
        </div>
      </div>

      <div class="bp-track"><div class="bp-fill {over ? 'over' : ''}" style="width:{pct}%"></div></div>
      <div class="kv" style="margin-top:8px"><span>課税支給額（手当・税の基準）</span><span class="num">{yen(taxableYtd)} / {yen(cap)}（{pct}%）</span></div>
      <div class="kv" style="margin-top:6px"><span>総支給（通勤手当込み・参考）</span><span class="num">{yen(grossYtd)}</span></div>
      {#if hasCommute}
        <div class="kv" style="margin-top:6px"><span>通勤手当（判明分の合計）</span><span class="num">{yen(commuteYtd)}</span></div>
      {/if}
      {#if minutesYtd > 0}
        <div class="kv" style="margin-top:6px"><span>総労働時間（判明分）</span><span class="num {weeklyAvgHours >= 20 ? 'neg' : ''}">{Math.round(totalHours).toLocaleString('ja-JP')}時間 ／ 週平均 {weeklyAvgHours.toFixed(1)}h</span></div>
      {/if}
      {#if isThisYear && projected > 0}
        <div class="reserve"><span>このペースの年間着地見込み（課税）</span><span class="num {projected > cap ? 'neg' : ''}">{yen(projected)}</span></div>
      {/if}
    </section>

    <div class="day-head"><span>月別のえみ給料（総支給）</span><span>社保の月8.8万ライン</span></div>
    <ul class="tx-list">
      {#each MONTHS as m (m)}
        <li class="tx-row">
          <div class="tx-main">
            <span class="tx-name">{m}月</span>
            <span class="tx-sub">{grossM[m - 1] > SHAHO_MONTH_LINE ? '⚠️ 月8.8万超' : grossM[m - 1] > 0 ? 'OK' : '—'}{detM[m - 1].minutes != null ? ` · ${(detM[m - 1].minutes! / 60).toFixed(0)}時間` : ''}</span>
          </div>
          <span class="tx-amt {grossM[m - 1] > SHAHO_MONTH_LINE ? 'neg' : ''}">{grossM[m - 1] ? yen(grossM[m - 1]) : '−'}</span>
        </li>
      {/each}
    </ul>

    <p class="hint">暦年（1〜12月）・支給日ベースで集計（年末調整還付は報酬ではないため対象外）。<strong>上限判定は課税支給額（通勤手当を除く＝103万手当・税の正しい基準）</strong>。明細を取り込むと課税支給額・通勤手当・総労働時間が自動で貯まります（未取込の月は総支給で代用）。上限の既定 {yen(cap)} は夫の会社の扶養手当（配偶者の年収103万円以下が条件）に合わせた最も低い壁。</p>
    <p class="hint">⚠️ 社保は別軸：2026年9月までは「週20時間以上＋月8.8万円以上」、<strong>2026年10月からは賃金要件が撤廃され「週20時間以上」だけ</strong>で加入対象。総労働時間の週平均が20時間に近いか要注意。時給・上限は設定タブで変更できます。</p>
  {/if}
</div>
