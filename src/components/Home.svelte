<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from '../lib/supabase'
  import { budgetMonthOf, budgetMonthRange, ymd, yen } from '../lib/month'
  import type { Transaction, Category } from '../lib/types'

  let loading = $state(true)
  let error = $state<string | null>(null)
  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})

  const now = new Date()
  const bm = budgetMonthOf(now)
  const range = budgetMonthRange(bm.year, bm.month)

  const income = $derived(txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0))
  const expense = $derived(txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0))
  const net = $derived(income - expense)
  const recent = $derived(txs.slice(0, 8))

  async function load() {
    loading = true; error = null
    const [cRes, tRes] = await Promise.all([
      supabase.from('categories').select('*'),
      supabase.from('transactions').select('*')
        .gte('date', ymd(range.start)).lt('date', ymd(range.end))
        .order('date', { ascending: false }).order('created_at', { ascending: false }),
    ])
    if (cRes.error || tRes.error) {
      error = (cRes.error ?? tRes.error)!.message
      loading = false
      return
    }
    cats = Object.fromEntries(((cRes.data ?? []) as Category[]).map(c => [c.id, c]))
    txs = (tRes.data ?? []) as Transaction[]
    loading = false
  }
  onMount(load)

  function catName(id: string | null) {
    return id && cats[id] ? cats[id].name : '未分類'
  }
</script>

<div class="home">
  <div class="month-head">{bm.year}年{bm.month}月</div>

  <section class="summary">
    <div class="net-label">今月の収支</div>
    <div class="net {net >= 0 ? 'pos' : 'neg'}">{net >= 0 ? '+' : '−'}{yen(Math.abs(net))}</div>
    <div class="io">
      <div class="io-cell">
        <span class="io-label">収入</span>
        <span class="io-val pos">{yen(income)}</span>
      </div>
      <div class="io-cell">
        <span class="io-label">支出</span>
        <span class="io-val neg">{yen(expense)}</span>
      </div>
    </div>
  </section>

  <section class="recent">
    <h2 class="recent-title">最近の取引</h2>
    {#if loading}
      <p class="state">読み込み中…</p>
    {:else if error}
      <p class="state err">読み込めませんでした：{error}</p>
    {:else if recent.length === 0}
      <p class="state">この月の取引はまだありません。「入力する」から記録を始めましょう。</p>
    {:else}
      <ul class="tx-list">
        {#each recent as t (t.id)}
          <li class="tx-row">
            <div class="tx-main">
              <span class="tx-name">{t.memo || catName(t.category_id)}</span>
              <span class="tx-sub">{catName(t.category_id)}{t.person ? ' · ' + t.person : ''} · {t.date.slice(5)}</span>
            </div>
            <span class="tx-amt {t.type === 'income' ? 'pos' : 'neg'}">
              {t.type === 'income' ? '+' : '−'}{yen(t.amount)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
