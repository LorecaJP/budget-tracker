<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthRange, ymd, yen, getMonthStartDay } from '../lib/month'
  import { listTransactions, listCategories, listBudgetsForYear, type Budget } from '../lib/db'
  import type { Transaction, Category, Division } from '../lib/types'
  import { DIVISION_LABELS } from '../lib/types'

  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  // 表示順（収入が先、振替は集計外）。支出計は税金〜変動費の合計。
  const DIV_ORDER: Division[] = ['income', 'tax', 'saving', 'fixed', 'variable']
  const EXPENSE_DIVS: Division[] = ['tax', 'saving', 'fixed', 'variable']

  let year = $state(new Date().getFullYear())
  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let budgets = $state<Budget[]>([])
  let loading = $state(true)
  // 区分の開閉（既定：固定費・変動費を開く＝注目度が高い）
  let open = $state<Record<string, boolean>>({ income: false, tax: false, saving: false, fixed: true, variable: true })

  const zeros = () => new Array(12).fill(0) as number[]
  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0)

  interface Cell { v: number; est: boolean }
  interface Row { name: string; cells: Cell[]; total: number }
  interface DivBlock { div: Division; label: string; rows: Row[]; subtotal: number[]; subTotalSum: number }

  // カテゴリ別の実績（カテゴリID→12ヶ月）＋ 未分類（区分→12ヶ月）
  const actual = $derived.by(() => {
    const bounds = MONTHS.map(m => {
      const r = budgetMonthRange(year, m)
      return [ymd(r.start), ymd(r.end)] as const
    })
    const byCat: Record<string, number[]> = {}
    const uncat: Record<string, number[]> = {}
    for (const t of txs) {
      if (t.type === 'transfer') continue
      let i = -1
      for (let k = 0; k < 12; k++) if (t.date >= bounds[k][0] && t.date < bounds[k][1]) { i = k; break }
      if (i < 0) continue
      if (t.category_id && cats[t.category_id]) {
        const arr = (byCat[t.category_id] ??= zeros()); arr[i] += t.amount
      } else {
        const d = t.type === 'income' ? 'income' : 'variable'
        const arr = (uncat[d] ??= zeros()); arr[i] += t.amount
      }
    }
    return { byCat, uncat }
  })

  // カテゴリ別の予算（＝予定額）。period_month 'Y-MM' を列インデックスへ。
  const budgetByCat = $derived.by(() => {
    const m: Record<string, number[]> = {}
    for (const b of budgets) {
      const mm = parseInt(b.period_month.slice(5, 7), 10)
      if (mm < 1 || mm > 12) continue
      (m[b.category_id] ??= zeros())[mm - 1] = b.amount
    }
    return m
  })

  // カテゴリを区分でグルーピング（sort_order 順）
  const catsByDiv = $derived.by(() => {
    const m: Record<string, Category[]> = {}
    for (const c of Object.values(cats)) {
      if (c.archived) continue
      (m[c.division] ??= []).push(c)
    }
    for (const k in m) m[k].sort((a, b) => a.sort_order - b.sort_order)
    return m
  })

  // 表示用モデル：区分ごとのカテゴリ行（実績優先・無ければ予定）＋小計
  const model = $derived.by<DivBlock[]>(() => {
    const blocks: DivBlock[] = []
    for (const div of DIV_ORDER) {
      const rows: Row[] = []
      const subtotal = zeros()
      for (const c of (catsByDiv[div] ?? [])) {
        const a = actual.byCat[c.id] ?? zeros()
        const b = budgetByCat[c.id] ?? zeros()
        const cells: Cell[] = MONTHS.map((_, i) => {
          if (a[i] > 0) return { v: a[i], est: false }
          return { v: b[i], est: b[i] > 0 }
        })
        const total = sum(cells.map(c => c.v))
        if (total === 0) continue   // 実績も予定も無いカテゴリは隠す
        for (let i = 0; i < 12; i++) subtotal[i] += cells[i].v
        rows.push({ name: c.name, cells, total })
      }
      // 未分類の実績（予算なし）
      const u = actual.uncat[div]
      if (u && sum(u) !== 0) {
        const cells: Cell[] = u.map(v => ({ v, est: false }))
        for (let i = 0; i < 12; i++) subtotal[i] += cells[i].v
        rows.push({ name: '(未分類)', cells, total: sum(u) })
      }
      blocks.push({ div, label: DIVISION_LABELS[div], rows, subtotal, subTotalSum: sum(subtotal) })
    }
    return blocks
  })

  const blockOf = (d: Division) => model.find(b => b.div === d)
  const incomeSub = $derived(blockOf('income')?.subtotal ?? zeros())
  const expenseTotal = $derived(MONTHS.map((_, i) => EXPENSE_DIVS.reduce((s, d) => s + (blockOf(d)?.subtotal[i] ?? 0), 0)))
  const netCells = $derived(MONTHS.map((_, i) => incomeSub[i] - expenseTotal[i]))

  const incomeYear = $derived(sum(incomeSub))
  const expenseYear = $derived(sum(expenseTotal))
  const netYear = $derived(incomeYear - expenseYear)
  const hasData = $derived(model.some(b => b.rows.length > 0))

  async function load() {
    loading = true
    if (Object.keys(cats).length === 0) {
      const cl = await listCategories()
      cats = Object.fromEntries(cl.map(c => [c.id, c]))
    }
    const start = budgetMonthRange(year, 1).start
    const end = budgetMonthRange(year, 12).end
    txs = await listTransactions(ymd(start), ymd(end))
    budgets = await listBudgetsForYear(year)
    loading = false
  }
  onMount(load)

  function go(delta: number) { year += delta; load() }
  function toggle(d: Division) { open[d] = !open[d] }
  function cell(v: number) { return v ? yen(v) : '−' }
  function signed(v: number) { return (v < 0 ? '−' : '') + yen(Math.abs(v)) }
</script>

<div class="month-nav">
  <button class="nav-btn" onclick={() => go(-1)} aria-label="前の年">‹</button>
  <span class="month-title">{year}年</span>
  <button class="nav-btn" onclick={() => go(1)} aria-label="次の年">›</button>
</div>

{#if loading}
  <p class="state">集計中…</p>
{:else if !hasData}
  <p class="state">この年の収支・予定がありません。設定の「予算」で予定額を入れると、ここに見込みが並びます。</p>
{:else}
  <section class="summary">
    <div class="net-label">年間収支（実績＋予定）</div>
    <div class="net {netYear >= 0 ? 'pos' : 'neg'}">{netYear >= 0 ? '+' : '−'}{yen(Math.abs(netYear))}</div>
    <div class="io">
      <div class="io-cell"><span class="io-label">収入</span><span class="io-val pos">{yen(incomeYear)}</span></div>
      <div class="io-cell"><span class="io-label">支出</span><span class="io-val neg">{yen(expenseYear)}</span></div>
    </div>
  </section>

  <div class="year-scroll">
    <table class="year-table">
      <thead>
        <tr>
          <th>区分・費目</th>
          {#each MONTHS as m}<th>{m}月</th>{/each}
          <th class="total">合計</th>
        </tr>
      </thead>
      <tbody>
        {#each model as b (b.div)}
          <tr class="div-row" onclick={() => toggle(b.div)}>
            <th>{b.rows.length ? (open[b.div] ? '▾' : '▸') : '　'} {b.label}</th>
            {#each b.subtotal as v}<td class={v ? '' : 'z'}>{cell(v)}</td>{/each}
            <td class="total">{b.subTotalSum ? yen(b.subTotalSum) : '−'}</td>
          </tr>
          {#if open[b.div]}
            {#each b.rows as r}
              <tr class="cat-row">
                <th>{r.name}</th>
                {#each r.cells as c}<td class="{c.v ? '' : 'z'} {c.est ? 'est' : ''}">{cell(c.v)}</td>{/each}
                <td class="total">{r.total ? yen(r.total) : '−'}</td>
              </tr>
            {/each}
          {/if}
          {#if b.div === 'variable'}
            <tr class="sum-row">
              <th>支出計</th>
              {#each expenseTotal as v}<td class={v ? '' : 'z'}>{cell(v)}</td>{/each}
              <td class="total">{yen(expenseYear)}</td>
            </tr>
            <tr class="net-row">
              <th>収支</th>
              {#each netCells as v}<td class={v === 0 ? 'z' : v > 0 ? 'pos' : 'neg'}>{v === 0 ? '−' : signed(v)}</td>{/each}
              <td class="total {netYear >= 0 ? 'pos' : 'neg'}">{signed(netYear)}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>

  <p class="hint">予算月（{getMonthStartDay()}日始まり）で集計。<span class="est-legend">薄い数字</span>は予定（予算）＝実績が入ると置き換わります。区分の行をタップで開閉。振替は含めません。</p>
{/if}
