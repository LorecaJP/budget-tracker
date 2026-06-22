<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthOf, budgetMonthRange, periodKey, ymd, yen } from '../lib/month'
  import { listTransactions, listCategories, listBudgets, listAccounts } from '../lib/db'
  import type { Transaction, Category, Account } from '../lib/types'

  let loading = $state(true)
  let error = $state<string | null>(null)
  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let accs = $state<Record<string, Account>>({})
  let budgets = $state<{ category_id: string; amount: number }[]>([])

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

  async function load() {
    loading = true; error = null
    const cl = await listCategories()
    cats = Object.fromEntries(cl.map(c => [c.id, c]))
    const al = await listAccounts()
    accs = Object.fromEntries(al.map(a => [a.id, a]))
    txs = await listTransactions(ymd(range.start), ymd(range.end))
    budgets = await listBudgets(periodKey(bm.year, bm.month))
    loading = false
  }
  onMount(load)

  function catName(id: string | null) { return id && cats[id] ? cats[id].name : '未分類' }
  function accName(id: string | null) { return id && accs[id] ? accs[id].name : '—' }
  // 取引の区分から、行頭アイコンの色とアイコン種別を決める
  function txKind(t: Transaction): { color: string; icon: string } {
    if (t.type === 'transfer') return { color: '#9398A0', icon: 'transfer' }
    if (t.type === 'income') return { color: '#1F6F58', icon: 'income' }
    const d = (t.category_id && cats[t.category_id]?.division) || ''
    if (d === 'fixed') return { color: '#2A6DB5', icon: 'home' }
    if (d === 'tax') return { color: '#8A8A8E', icon: 'receipt' }
    if (d === 'saving') return { color: '#7A5AA8', icon: 'coins' }
    return { color: '#E0913B', icon: 'cart' }
  }
</script>

{#snippet txIcon(name: string)}
  {#if name === 'income'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
  {:else if name === 'cart'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
  {:else if name === 'home'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/></svg>
  {:else if name === 'receipt'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6"/></svg>
  {:else if name === 'coins'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M15 7.5a6 6 0 1 1 0 9"/></svg>
  {:else if name === 'transfer'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
  {/if}
{/snippet}

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
        {@const k = txKind(t)}
        <li class="tx-row">
          <span class="tx-ic" style="background:{k.color}">{@render txIcon(k.icon)}</span>
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
