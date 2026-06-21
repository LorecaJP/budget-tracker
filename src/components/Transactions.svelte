<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthOf, budgetMonthRange, shiftBudgetMonth, ymd, yen } from '../lib/month'
  import { listTransactions, listCategories, listAccounts } from '../lib/db'
  import type { Transaction, Category, Account, TxType } from '../lib/types'
  import AddTransaction from './AddTransaction.svelte'
  import PayslipImport from './PayslipImport.svelte'

  const today = budgetMonthOf(new Date())
  let year = $state(today.year)
  let month = $state(today.month)

  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let accounts = $state<Account[]>([])
  let accMap = $state<Record<string, Account>>({})
  let catList = $state<Category[]>([])
  let loading = $state(true)

  let fType = $state<TxType | ''>('')
  let fCat = $state('')
  let fPerson = $state('')
  let editing = $state<Transaction | null>(null)
  let showImport = $state(false)

  const grouped = $derived.by(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of txs) {
      if (!map.has(t.date)) map.set(t.date, [])
      map.get(t.date)!.push(t)
    }
    // 各日付内は 収入 → 振替 → 支出 の順（同種は元の並び＝新しい順を維持）
    const rank = (t: Transaction) => (t.type === 'income' ? 0 : t.type === 'transfer' ? 1 : 2)
    for (const list of map.values()) list.sort((a, b) => rank(a) - rank(b))
    return [...map.entries()]
  })

  async function load() {
    loading = true
    const r = budgetMonthRange(year, month)
    if (catList.length === 0) {
      catList = await listCategories()
      accounts = await listAccounts()
      cats = Object.fromEntries(catList.map(c => [c.id, c]))
      accMap = Object.fromEntries(accounts.map(a => [a.id, a]))
    }
    txs = await listTransactions(ymd(r.start), ymd(r.end), {
      type: fType, categoryId: fCat, person: fPerson,
    })
    loading = false
  }
  onMount(load)

  function go(delta: number) {
    const m = shiftBudgetMonth(year, month, delta)
    year = m.year; month = m.month; load()
  }
  function dayTotal(list: Transaction[]) {
    return list.reduce((s, t) => {
      if (t.type === 'transfer') return s   // 振替は収支に含めない
      return s + (t.type === 'income' ? t.amount : -t.amount)
    }, 0)
  }
  function catName(id: string | null) { return id && cats[id] ? cats[id].name : '未分類' }
  function accName(id: string | null) { return id && accMap[id] ? accMap[id].name : '—' }
</script>

<div class="screen">
  <div class="month-nav">
    <button class="nav-btn" onclick={() => go(-1)} aria-label="前の月">‹</button>
    <span class="month-title">{year}年{month}月</span>
    <button class="nav-btn" onclick={() => go(1)} aria-label="次の月">›</button>
  </div>

  <div class="filters">
    <select bind:value={fType} onchange={load}>
      <option value="">すべて</option><option value="expense">支出</option><option value="income">収入</option><option value="transfer">振替</option>
    </select>
    <select bind:value={fCat} onchange={load}>
      <option value="">全カテゴリ</option>
      {#each catList as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <select bind:value={fPerson} onchange={load}>
      <option value="">全員</option><option value="ゆうき">ゆうき</option><option value="えみ">えみ</option>
    </select>
  </div>

  <button class="add-inline" onclick={() => showImport = true}>📄 給与PDFを取り込む</button>

  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if grouped.length === 0}
    <p class="state">この条件の取引はありません。</p>
  {:else}
    {#each grouped as [date, list] (date)}
      <div class="day-head">
        <span>{date.slice(5).replace('-', '/')}</span>
        <span class="{dayTotal(list) >= 0 ? 'pos' : 'neg'}">{dayTotal(list) >= 0 ? '+' : '−'}{yen(Math.abs(dayTotal(list)))}</span>
      </div>
      <ul class="tx-list">
        {#each list as t (t.id)}
          <li class="tx-row tappable" onclick={() => editing = t}>
            {#if t.type === 'transfer'}
              <div class="tx-main">
                <span class="tx-name">{t.memo || '振替'}</span>
                <span class="tx-sub">{accName(t.account_id)} → {accName(t.to_account_id)}</span>
              </div>
              <span class="tx-amt muted">{yen(t.amount)}</span>
            {:else}
              <div class="tx-main">
                <span class="tx-name">{t.memo || catName(t.category_id)}</span>
                <span class="tx-sub">{catName(t.category_id)}{t.person ? ' · ' + t.person : ''}</span>
              </div>
              <span class="tx-amt {t.type === 'income' ? 'pos' : 'neg'}">{t.type === 'income' ? '+' : '−'}{yen(t.amount)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</div>

{#if editing}
  <AddTransaction existing={editing} onclose={() => editing = null} onsaved={() => { editing = null; load() }} />
{/if}

{#if showImport}
  <PayslipImport onclose={() => showImport = false} onsaved={() => { showImport = false; load() }} />
{/if}
