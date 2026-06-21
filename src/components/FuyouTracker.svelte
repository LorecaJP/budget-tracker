<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { getFuyouConfig, listEmiSalaryYear, type FuyouConfig } from '../lib/db'
  import type { Transaction } from '../lib/types'

  // 社会保険(106万)の月次トリガー目安：月8.8万円（所定内賃金ベース・参考表示）
  const SHAHO_MONTH_LINE = 88000
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  const now = new Date()
  let year = $state(now.getFullYear())
  let cfg = $state<FuyouConfig>({ hourly_wage: 1180, year_cap: 1060000 })
  let txs = $state<Transaction[]>([])
  let loading = $state(true)

  async function load() {
    loading = true
    cfg = await getFuyouConfig()
    txs = await listEmiSalaryYear(year)
    loading = false
  }
  onMount(load)
  function go(d: number) { year += d; load() }

  // 暦月(1-12)ごとの「えみ給料」合計（支給日ベース）
  const monthly = $derived.by(() => {
    const arr = new Array(12).fill(0) as number[]
    for (const t of txs) {
      const m = Number(t.date.slice(5, 7))
      if (m >= 1 && m <= 12) arr[m - 1] += t.amount
    }
    return arr
  })
  const cap = $derived(cfg.year_cap)
  const wage = $derived(cfg.hourly_wage)
  const ytd = $derived(monthly.reduce((s, n) => s + n, 0))
  const over = $derived(ytd > cap)
  const overage = $derived(Math.max(0, ytd - cap))
  const remaining = $derived(Math.max(0, cap - ytd))
  const pct = $derived(cap > 0 ? Math.min(100, Math.round((ytd / cap) * 100)) : 0)
  const remainHours = $derived(wage > 0 ? Math.floor(remaining / wage) : 0)
  // 支給のあった月数から年間着地を素朴に見込む
  const paidMonths = $derived(monthly.filter(v => v > 0).length)
  const projected = $derived(paidMonths > 0 ? Math.round((ytd / paidMonths) * 12) : 0)
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
          <div class="fuyou-cap">{over ? '超過した金額' : 'あと稼げる金額'}</div>
        </div>
        <div class="fuyou-stat">
          <div class="fuyou-big {over ? 'neg' : 'pos'}">約{remainHours.toLocaleString('ja-JP')}<span class="fuyou-unit">時間</span></div>
          <div class="fuyou-cap">あと働ける時間（時給{yen(wage)}）</div>
        </div>
      </div>

      <div class="bp-track"><div class="bp-fill {over ? 'over' : ''}" style="width:{pct}%"></div></div>
      <div class="kv" style="margin-top:8px"><span>今年のえみ給料</span><span class="num">{yen(ytd)} / {yen(cap)}（{pct}%）</span></div>
      {#if isThisYear && projected > 0}
        <div class="kv" style="margin-top:8px"><span>このペースの年間着地見込み</span><span class="num {projected > cap ? 'neg' : ''}">{yen(projected)}</span></div>
      {/if}
    </section>

    <div class="day-head"><span>月別のえみ給料</span><span>社保の月8.8万ライン</span></div>
    <ul class="tx-list">
      {#each MONTHS as m (m)}
        <li class="tx-row">
          <div class="tx-main">
            <span class="tx-name">{m}月</span>
            <span class="tx-sub">{monthly[m - 1] > SHAHO_MONTH_LINE ? '⚠️ 月8.8万超' : monthly[m - 1] > 0 ? 'OK' : '—'}</span>
          </div>
          <span class="tx-amt {monthly[m - 1] > SHAHO_MONTH_LINE ? 'neg' : ''}">{monthly[m - 1] ? yen(monthly[m - 1]) : '−'}</span>
        </li>
      {/each}
    </ul>

    <p class="hint">暦年（1〜12月）・支給日ベースで「えみ給料」を集計（年末調整還付は報酬ではないため対象外）。上限の既定 {yen(cap)} は夫の会社の扶養手当（配偶者の年収103万円以下が条件）に合わせた最も低い壁で、これを守れば税・社保（106万/130万）の壁も自動的にクリアできます。</p>
    <p class="hint">⚠️ 社保は別軸：2026年9月までは「週20時間以上＋月8.8万円以上」、<strong>2026年10月からは賃金要件が撤廃され「週20時間以上」だけ</strong>で加入対象（金額では決まらない）。103万に抑えても週20時間以上だと社保の扶養は外れます。時給・上限は設定タブで変更できます。</p>
  {/if}
</div>
