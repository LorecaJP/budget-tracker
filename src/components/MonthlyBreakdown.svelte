<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthOf, budgetMonthRange, shiftBudgetMonth, periodKey, ymd, yen } from '../lib/month'
  import { listTransactions, listCategories, listBudgets, type Budget } from '../lib/db'
  import type { Transaction, Category, Division } from '../lib/types'
  import { DIVISION_LABELS } from '../lib/types'

  const DIV_ORDER: Division[] = ['income', 'tax', 'saving', 'fixed', 'variable']
  const EXPENSE_DIVS: Division[] = ['tax', 'saving', 'fixed', 'variable']

  const today = budgetMonthOf(new Date())
  let year = $state(today.year)
  let month = $state(today.month)

  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let budgets = $state<Record<string, number>>({})   // category_id -> 予定額
  let loading = $state(true)

  interface Row { name: string; actual: number; plan: number }
  interface Block { div: Division; label: string; rows: Row[]; actSum: number; planSum: number }

  const catsByDiv = $derived.by(() => {
    const m: Record<string, Category[]> = {}
    for (const c of Object.values(cats)) {
      if (c.archived) continue
      (m[c.division] ??= []).push(c)
    }
    for (const k in m) m[k].sort((a, b) => a.sort_order - b.sort_order)
    return m
  })

  // カテゴリ別の実績（実績はこの予算月の取引合計）
  const actualByCat = $derived.by(() => {
    const m: Record<string, number> = {}
    const uncat: Record<string, number> = {}
    for (const t of txs) {
      if (t.type === 'transfer') continue
      if (t.category_id && cats[t.category_id]) m[t.category_id] = (m[t.category_id] ?? 0) + t.amount
      else { const d = t.type === 'income' ? 'income' : 'variable'; uncat[d] = (uncat[d] ?? 0) + t.amount }
    }
    return { m, uncat }
  })

  const model = $derived.by<Block[]>(() => {
    const blocks: Block[] = []
    for (const div of DIV_ORDER) {
      const rows: Row[] = []
      let actSum = 0, planSum = 0
      for (const c of (catsByDiv[div] ?? [])) {
        const actual = actualByCat.m[c.id] ?? 0
        const plan = budgets[c.id] ?? 0
        if (actual === 0 && plan === 0) continue
        rows.push({ name: c.name, actual, plan })
        actSum += actual; planSum += plan
      }
      const u = actualByCat.uncat[div] ?? 0
      if (u !== 0) { rows.push({ name: '(未分類)', actual: u, plan: 0 }); actSum += u }
      if (rows.length) blocks.push({ div, label: DIVISION_LABELS[div], rows, actSum, planSum })
    }
    return blocks
  })

  const blockOf = (d: Division) => model.find(b => b.div === d)
  const incomeAct = $derived(blockOf('income')?.actSum ?? 0)
  const expenseAct = $derived(EXPENSE_DIVS.reduce((s, d) => s + (blockOf(d)?.actSum ?? 0), 0))
  const expensePlan = $derived(EXPENSE_DIVS.reduce((s, d) => s + (blockOf(d)?.planSum ?? 0), 0))
  const netAct = $derived(incomeAct - expenseAct)

  async function load() {
    loading = true
    if (Object.keys(cats).length === 0) {
      const cl = await listCategories()
      cats = Object.fromEntries(cl.map(c => [c.id, c]))
    }
    const r = budgetMonthRange(year, month)
    txs = await listTransactions(ymd(r.start), ymd(r.end))
    const bl: Budget[] = await listBudgets(periodKey(year, month))
    budgets = Object.fromEntries(bl.map(b => [b.category_id, b.amount]))
    loading = false
  }
  onMount(load)

  function go(delta: number) {
    const m = shiftBudgetMonth(year, month, delta)
    year = m.year; month = m.month; load()
  }
  const pct = (a: number, p: number) => (p > 0 ? Math.min(100, (a / p) * 100) : 0)
</script>

<div class="month-nav">
  <button class="nav-btn" onclick={() => go(-1)} aria-label="前の月">‹</button>
  <span class="month-title">{year}年{month}月</span>
  <button class="nav-btn" onclick={() => go(1)} aria-label="次の月">›</button>
</div>

{#if loading}
  <p class="state">集計中…</p>
{:else}
  <section class="summary">
    <div class="net-label">今月の収支</div>
    <div class="net {netAct >= 0 ? 'pos' : 'neg'}">{netAct >= 0 ? '+' : '−'}{yen(Math.abs(netAct))}</div>
    <div class="io io-3">
      <div class="io-cell"><span class="io-label">収入</span><span class="io-val pos">{yen(incomeAct)}</span></div>
      <div class="io-cell"><span class="io-label">支出</span><span class="io-val neg">{yen(expenseAct)}</span></div>
      <div class="io-cell"><span class="io-label">予定支出</span><span class="io-val">{yen(expensePlan)}</span></div>
    </div>
  </section>

  {#if model.length === 0}
    <p class="state">この月の取引・予定はありません。</p>
  {/if}

  {#each model as b (b.div)}
    <div class="sec-head">{b.label}<span class="sh-sum">{yen(b.actSum)}{b.planSum ? ` / 予定 ${yen(b.planSum)}` : ''}</span></div>
    <section class="card">
      {#each b.rows as r}
        {@const over = r.plan > 0 && r.actual > r.plan}
        <div class="mb-row">
          <div class="mb-head">
            <span class="mb-name">{r.name}</span>
            <span class="mb-num"><b class={over ? 'neg' : ''}>{yen(r.actual)}</b>{r.plan ? ` / ${yen(r.plan)}` : ''}</span>
          </div>
          {#if r.plan > 0 && b.div !== 'income'}
            <div class="bp-track"><div class="bp-fill {over ? 'over' : ''}" style="width:{pct(r.actual, r.plan)}%"></div></div>
          {/if}
        </div>
      {/each}
    </section>
  {/each}

  <p class="hint">実績は取引の合計、「/」の後は予定（予算）。予定額は設定の「予算」で入れられます（固定費は12ヶ月へ一括も可）。振替は含めません。</p>
{/if}
