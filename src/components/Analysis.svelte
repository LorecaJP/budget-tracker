<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthOf, budgetMonthRange, shiftBudgetMonth, lastNBudgetMonths, ymd, yen } from '../lib/month'
  import { listTransactions, listCategories } from '../lib/db'
  import type { Transaction, Category, Division } from '../lib/types'

  const today = budgetMonthOf(new Date())
  let year = $state(today.year)
  let month = $state(today.month)
  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let trend = $state<{ label: string; expense: number }[]>([])
  let loading = $state(true)

  const PALETTE = ['#1F6F58', '#D85A30', '#7F77DD', '#378ADD', '#EF9F27', '#B4452E', '#888780', '#2E8B74', '#9A6BD8']

  const expenseTxs = $derived(txs.filter(t => t.type === 'expense'))
  const totalExpense = $derived(expenseTxs.reduce((s, t) => s + t.amount, 0))

  // カテゴリ別集計
  const byCat = $derived.by(() => {
    const m = new Map<string, number>()
    for (const t of expenseTxs) {
      const name = (t.category_id && cats[t.category_id]) ? cats[t.category_id].name : '未分類'
      m.set(name, (m.get(name) ?? 0) + t.amount)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  })

  // ドーナツのセグメント
  const C = 339.292 // 2πr (r=54)
  const donut = $derived.by(() => {
    let acc = 0
    return byCat.map(([name, amt], i) => {
      const frac = totalExpense ? amt / totalExpense : 0
      const seg = { name, amt, len: frac * C, rot: (acc / (totalExpense || 1)) * 360 - 90, color: PALETTE[i % PALETTE.length], pct: Math.round(frac * 100) }
      acc += amt
      return seg
    })
  })

  // 固定費 vs 変動費
  const fixedVar = $derived.by(() => {
    let fixed = 0, variable = 0, other = 0
    for (const t of expenseTxs) {
      const d: Division | undefined = t.category_id ? cats[t.category_id]?.division : undefined
      if (d === 'fixed') fixed += t.amount
      else if (d === 'variable') variable += t.amount
      else other += t.amount
    }
    return { fixed, variable, other }
  })

  // 曜日別
  const byWeekday = $derived.by(() => {
    const arr = [0, 0, 0, 0, 0, 0, 0] // 日..土
    for (const t of expenseTxs) {
      const wd = new Date(t.date).getDay()
      arr[wd] += t.amount
    }
    return arr
  })
  const wdMax = $derived(Math.max(1, ...byWeekday))
  const WD = ['日', '月', '火', '水', '木', '金', '土']

  async function load() {
    loading = true
    if (Object.keys(cats).length === 0) {
      const cl = await listCategories()
      cats = Object.fromEntries(cl.map(c => [c.id, c]))
    }
    const r = budgetMonthRange(year, month)
    txs = await listTransactions(ymd(r.start), ymd(r.end))

    // 直近6ヶ月の支出推移
    const months = lastNBudgetMonths(year, month, 6)
    const t: { label: string; expense: number }[] = []
    for (const m of months) {
      const rr = budgetMonthRange(m.year, m.month)
      const list = await listTransactions(ymd(rr.start), ymd(rr.end), { type: 'expense' })
      t.push({ label: `${m.month}月`, expense: list.reduce((s, x) => s + x.amount, 0) })
    }
    trend = t
    loading = false
  }
  onMount(load)

  function go(delta: number) {
    const m = shiftBudgetMonth(year, month, delta)
    year = m.year; month = m.month; load()
  }
  const trendMax = $derived(Math.max(1, ...trend.map(t => t.expense)))
</script>

<div class="screen">
  <h1 class="lg-title">分析</h1>
  <div class="month-nav">
    <button class="nav-btn" onclick={() => go(-1)} aria-label="前の月">‹</button>
    <span class="month-title">{year}年{month}月</span>
    <button class="nav-btn" onclick={() => go(1)} aria-label="次の月">›</button>
  </div>

  {#if loading}
    <p class="state">集計中…</p>
  {:else if totalExpense === 0}
    <p class="state">この月の支出データがありません。</p>
  {:else}
    <section class="card">
      <div class="card-label">カテゴリ構成</div>
      <div class="donut-wrap">
        <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="カテゴリ別支出">
          {#each donut as s}
            <circle cx="60" cy="60" r="54" fill="none" stroke={s.color} stroke-width="13"
              stroke-dasharray="{s.len} {C - s.len}" transform="rotate({s.rot} 60 60)" />
          {/each}
          <text x="60" y="57" text-anchor="middle" style="font-size:8px; fill:var(--muted)">支出計</text>
          <text x="60" y="70" text-anchor="middle" style="font-size:12px; font-weight:600; fill:var(--text)">{yen(totalExpense)}</text>
        </svg>
        <div class="legend">
          {#each donut.slice(0, 6) as s}
            <div class="legend-row"><span class="dot" style="background:{s.color}"></span>{s.name} {s.pct}%</div>
          {/each}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-label">固定費 vs 変動費</div>
      <div class="fv-bar">
        {#if fixedVar.fixed}<div class="fv-seg" style="flex:{fixedVar.fixed}; background:#378ADD"></div>{/if}
        {#if fixedVar.variable}<div class="fv-seg" style="flex:{fixedVar.variable}; background:#7F77DD"></div>{/if}
        {#if fixedVar.other}<div class="fv-seg" style="flex:{fixedVar.other}; background:#888780"></div>{/if}
      </div>
      <div class="fv-legend">
        <span><span class="dot" style="background:#378ADD"></span>固定 {yen(fixedVar.fixed)}</span>
        <span><span class="dot" style="background:#7F77DD"></span>変動 {yen(fixedVar.variable)}</span>
        <span><span class="dot" style="background:#888780"></span>その他 {yen(fixedVar.other)}</span>
      </div>
    </section>

    <section class="card">
      <div class="card-label">支出の推移（直近6ヶ月）</div>
      <div class="bars">
        {#each trend as t}
          <div class="bar-col">
            <div class="bar" style="height:{Math.round((t.expense / trendMax) * 80)}px"></div>
            <span class="bar-label">{t.label}</span>
          </div>
        {/each}
      </div>
    </section>

    <section class="card">
      <div class="card-label">曜日別の支出</div>
      <div class="bars">
        {#each byWeekday as v, i}
          <div class="bar-col">
            <div class="bar {i === 0 || i === 6 ? 'weekend' : ''}" style="height:{Math.round((v / wdMax) * 70)}px"></div>
            <span class="bar-label {i === 0 || i === 6 ? 'neg' : ''}">{WD[i]}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
