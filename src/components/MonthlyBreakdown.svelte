<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthOf, budgetMonthRange, shiftBudgetMonth, periodKey, ymd, yen } from '../lib/month'
  import { listTransactions, listCategories, listBudgets, setBudget, setBudgetAllMonths, listSpecialExpenses, type Budget, type SpecialExpense } from '../lib/db'
  import { session } from '../lib/session'
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
  let specials = $state<SpecialExpense[]>([])         // この年の特別費（臨時支出）
  let loading = $state(true)

  interface Row { id: string | null; name: string; actual: number; plan: number }
  interface Block { div: Division; label: string; rows: Row[]; actSum: number; planSum: number; foreSum: number }

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
      let actSum = 0, planSum = 0, foreSum = 0
      for (const c of (catsByDiv[div] ?? [])) {
        const actual = actualByCat.m[c.id] ?? 0
        const plan = budgets[c.id] ?? 0
        if (actual === 0 && plan === 0) continue
        rows.push({ id: c.id, name: c.name, actual, plan })
        actSum += actual; planSum += plan; foreSum += actual > 0 ? actual : plan
      }
      const u = actualByCat.uncat[div] ?? 0
      if (u !== 0) { rows.push({ id: null, name: '(未分類)', actual: u, plan: 0 }); actSum += u; foreSum += u }
      if (rows.length) blocks.push({ div, label: DIVISION_LABELS[div], rows, actSum, planSum, foreSum })
    }
    return blocks
  })

  const blockOf = (d: Division) => model.find(b => b.div === d)
  const incomeAct = $derived(blockOf('income')?.actSum ?? 0)
  // 特別費（この月の臨時支出）。実績(actual)優先・無ければ予定(budget)。支出に含める。
  const specialItems = $derived(specials.filter(s => s.planned_month === month))
  const specialAct = $derived(specialItems.reduce((s, x) => s + (x.actual_amount ?? 0), 0))
  const specialFore = $derived(specialItems.reduce((s, x) => s + (x.actual_amount ?? x.budget_amount), 0))
  const specialPlanSum = $derived(specialItems.reduce((s, x) => s + x.budget_amount, 0))
  const expenseAct = $derived(EXPENSE_DIVS.reduce((s, d) => s + (blockOf(d)?.actSum ?? 0), 0) + specialAct)
  const netAct = $derived(incomeAct - expenseAct)
  // 見込み＝実績があれば実績・無ければ予定（先の月は全部予定＝試算になる）
  const incomeFore = $derived(blockOf('income')?.foreSum ?? 0)
  const expenseFore = $derived(EXPENSE_DIVS.reduce((s, d) => s + (blockOf(d)?.foreSum ?? 0), 0) + specialFore)
  const foreNet = $derived(incomeFore - expenseFore)

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
    specials = await listSpecialExpenses(year)
    loading = false
  }
  onMount(load)

  function go(delta: number) {
    const m = shiftBudgetMonth(year, month, delta)
    year = m.year; month = m.month; load()
  }
  const pct = (a: number, p: number) => (p > 0 ? Math.min(100, (a / p) * 100) : 0)

  // 費目をタップして、この月の予定額（予算）をその場で編集
  let editing = $state<{ id: string; name: string; plan: number } | null>(null)
  let editAll = $state(false)
  function openBudget(id: string, name: string, plan: number) {
    editAll = false
    editing = { id, name, plan }
  }
  async function saveBudgetEdit() {
    if (!editing) return
    const amount = Math.round(editing.plan || 0)
    if (editAll) await setBudgetAllMonths(editing.id, year, amount, $session!.user.id)
    else await setBudget(editing.id, periodKey(year, month), amount, $session!.user.id)
    budgets[editing.id] = amount   // 即時反映（model が再計算）
    editing = null
  }
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
    <div class="net-label">見込みの残り</div>
    <div class="net {foreNet >= 0 ? 'pos' : 'neg'}">{foreNet >= 0 ? '+' : '−'}{yen(Math.abs(foreNet))}</div>
    <div class="net-sub">確定 {netAct >= 0 ? '+' : '−'}{yen(Math.abs(netAct))}（実績）</div>
    <div class="io">
      <div class="io-cell"><span class="io-label">収入（見込み）</span><span class="io-val pos">{yen(incomeFore)}</span></div>
      <div class="io-cell"><span class="io-label">支出（見込み）</span><span class="io-val neg">{yen(expenseFore)}</span></div>
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
        <div class="mb-row {r.id ? 'tappable' : ''}" onclick={() => r.id && openBudget(r.id, r.name, r.plan)}>
          <div class="mb-head">
            <span class="mb-name">{r.name}{#if r.id}<span class="mb-edit">›</span>{/if}</span>
            <span class="mb-num"><b class={over ? 'neg' : ''}>{yen(r.actual)}</b>{r.plan ? ` / ${yen(r.plan)}` : ''}</span>
          </div>
          {#if r.plan > 0 && b.div !== 'income'}
            <div class="bp-track"><div class="bp-fill {over ? 'over' : ''}" style="width:{pct(r.actual, r.plan)}%"></div></div>
          {/if}
        </div>
      {/each}
    </section>
  {/each}

  {#if specialItems.length}
    <div class="sec-head">特別費（今月の臨時）<span class="sh-sum">{yen(specialAct)}{specialPlanSum ? ` / 予定 ${yen(specialPlanSum)}` : ''}</span></div>
    <section class="card">
      {#each specialItems as s (s.id)}
        {@const over = s.actual_amount != null && s.actual_amount > s.budget_amount}
        <div class="mb-row">
          <div class="mb-head">
            <span class="mb-name">{s.name}</span>
            <span class="mb-num"><b class={over ? 'neg' : ''}>{yen(s.actual_amount ?? 0)}</b> / {yen(s.budget_amount)}</span>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  <p class="hint">実績は取引の合計、「/」の後は予定（予算）。<strong>費目をタップするとこの月の予定額を編集</strong>できます（特別費は「特別費」タブで編集）。特別費も見込みに含みます。振替は含めません。</p>
{/if}

{#if editing}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) editing = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => editing = null}>キャンセル</button><span></span><span></span></div>
      <div class="card-label">{year}年{month}月の予定額</div>
      <label class="field"><span>{editing.name}</span><input type="number" inputmode="numeric" bind:value={editing.plan} /></label>
      <label class="check"><input type="checkbox" bind:checked={editAll} /> {year}年の12ヶ月すべてに同額（給料・固定費向け）</label>
      <button class="primary" onclick={saveBudgetEdit}>保存</button>
    </div>
  </div>
{/if}
