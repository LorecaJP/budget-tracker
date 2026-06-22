<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthOf, budgetMonthRange, periodKey, ymd, yen } from '../lib/month'
  import { listTransactions, listCategories, listBudgets, listAccounts, sumSavingByCategory } from '../lib/db'
  import type { Transaction, Category, Account } from '../lib/types'
  import TxIcon from './TxIcon.svelte'

  let loading = $state(true)
  let error = $state<string | null>(null)
  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let accs = $state<Record<string, Account>>({})
  let budgets = $state<{ category_id: string; amount: number }[]>([])
  let savingTotals = $state<Record<string, number>>({})

  const bm = budgetMonthOf(new Date())
  const range = budgetMonthRange(bm.year, bm.month)

  const income = $derived(txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0))
  const expense = $derived(txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0))
  const net = $derived(income - expense)
  const recent = $derived(txs.slice(0, 6))

  // カテゴリ別の支出
  const spentByCat = $derived.by(() => {
    const m = new Map<string, number>()
    for (const t of txs) if (t.type === 'expense' && t.category_id) m.set(t.category_id, (m.get(t.category_id) ?? 0) + t.amount)
    return m
  })
  const budgetProgress = $derived(
    budgets.filter(b => b.amount > 0).map(b => ({
      name: cats[b.category_id]?.name ?? '—',
      budget: b.amount,
      spent: spentByCat.get(b.category_id) ?? 0,
    })).sort((a, b) => (b.spent / b.budget) - (a.spent / a.budget)).slice(0, 4)
  )

  // 貯金の目標（目標額が設定された貯蓄カテゴリ）と累計の進捗
  const savingGoals = $derived(
    Object.values(cats)
      .filter(c => !c.archived && c.division === 'saving' && (c.goal_amount ?? 0) > 0)
      .map(c => ({ name: c.name, goal: c.goal_amount as number, saved: savingTotals[c.id] ?? 0 }))
      .sort((a, b) => b.goal - a.goal)
  )

  async function load() {
    loading = true; error = null
    const cl = await listCategories()
    cats = Object.fromEntries(cl.map(c => [c.id, c]))
    const al = await listAccounts()
    accs = Object.fromEntries(al.map(a => [a.id, a]))
    txs = await listTransactions(ymd(range.start), ymd(range.end))
    budgets = await listBudgets(periodKey(bm.year, bm.month))
    const savingIds = cl.filter(c => c.division === 'saving' && (c.goal_amount ?? 0) > 0).map(c => c.id)
    savingTotals = await sumSavingByCategory(savingIds)
    loading = false
  }
  onMount(load)

  function catName(id: string | null) { return id && cats[id] ? cats[id].name : '未分類' }
  function accName(id: string | null) { return id && accs[id] ? accs[id].name : '—' }
  function catDiv(id: string | null): string | null { return (id && cats[id]?.division) || null }
</script>

<div class="screen">
  <h1 class="lg-title">ホーム<span class="lg-sub">{bm.year}年{bm.month}月</span></h1>

  <section class="home-hero">
    <div class="hh-label">今月の収支</div>
    <div class="hh-net">{net >= 0 ? '+' : '−'}{yen(Math.abs(net))}</div>
    <div class="hh-io">
      <div><span class="k">収入</span><span class="v">{yen(income)}</span></div>
      <div><span class="k">支出</span><span class="v">{yen(expense)}</span></div>
    </div>
  </section>

  {#if budgetProgress.length}
    <div class="sec-head">予算の進捗</div>
    <section class="card">
      {#each budgetProgress as b}
        <div class="bp">
          <div class="bp-head"><span>{b.name}</span><span class="num">{yen(b.spent)} / {yen(b.budget)}</span></div>
          <div class="bp-track"><div class="bp-fill {b.spent > b.budget ? 'over' : ''}" style="width:{Math.min(100, (b.spent / b.budget) * 100)}%"></div></div>
        </div>
      {/each}
    </section>
  {/if}

  {#if savingGoals.length}
    <div class="sec-head">貯金の目標</div>
    <section class="card">
      {#each savingGoals as g}
        <div class="bp">
          <div class="bp-head"><span>{g.name}</span><span class="num">{yen(g.saved)} / {yen(g.goal)}（{g.goal > 0 ? Math.round((g.saved / g.goal) * 100) : 0}%）</span></div>
          <div class="bp-track"><div class="bp-fill" style="width:{Math.min(100, g.goal > 0 ? (g.saved / g.goal) * 100 : 0)}%"></div></div>
        </div>
      {/each}
    </section>
  {/if}

  <div class="sec-head">最近の取引</div>
  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if error}
    <p class="state err">読み込めませんでした：{error}</p>
  {:else if recent.length === 0}
    <p class="state">この月の取引はまだありません。「入力」から記録を始めましょう。</p>
  {:else}
    <ul class="tx-list">
      {#each recent as t (t.id)}
        <li class="tx-row">
          <TxIcon type={t.type} division={catDiv(t.category_id)} name={catName(t.category_id)} />
          {#if t.type === 'transfer'}
            <div class="tx-main">
              <span class="tx-name">{t.memo || '振替'}</span>
              <span class="tx-sub">{accName(t.account_id)} → {accName(t.to_account_id)} · {t.date.slice(5)}</span>
            </div>
            <span class="tx-amt muted">{yen(t.amount)}</span>
          {:else}
            <div class="tx-main">
              <span class="tx-name">{t.memo || catName(t.category_id)}</span>
              <span class="tx-sub">{catName(t.category_id)}{t.person ? ' · ' + t.person : ''} · {t.date.slice(5)}</span>
            </div>
            <span class="tx-amt {t.type === 'income' ? 'pos' : 'neg'}">{t.type === 'income' ? '+' : '−'}{yen(t.amount)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
