<script lang="ts">
  import { onMount } from 'svelte'
  import { budgetMonthRange, ymd, yen, getMonthStartDay } from '../lib/month'
  import { listTransactions, listCategories } from '../lib/db'
  import type { Transaction, Category, Division } from '../lib/types'
  import { DIVISION_LABELS } from '../lib/types'

  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  // 支出側の会計区分（表示順）。収入は別行、振替は集計外。
  const EXPENSE_DIVS: Division[] = ['tax', 'saving', 'fixed', 'variable']

  let year = $state(new Date().getFullYear())
  let txs = $state<Transaction[]>([])
  let cats = $state<Record<string, Category>>({})
  let loading = $state(true)

  const zeros = () => new Array(12).fill(0) as number[]
  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0)

  // 会計区分 × 12予算月 の集計（振替は除外）
  const matrix = $derived.by(() => {
    // 各予算月の境界を 'YYYY-MM-DD' 文字列で持ち、文字列比較で振り分ける（タイムゾーン非依存）
    const bounds = MONTHS.map(m => {
      const r = budgetMonthRange(year, m)
      return [ymd(r.start), ymd(r.end)] as const
    })
    const acc: Record<string, number[]> = {}
    const ensure = (k: string) => (acc[k] ??= zeros())
    for (const t of txs) {
      if (t.type === 'transfer') continue   // 振替は口座間移動なので収支に含めない
      let i = -1
      for (let k = 0; k < 12; k++) if (t.date >= bounds[k][0] && t.date < bounds[k][1]) { i = k; break }
      if (i < 0) continue
      let d: Division
      if (t.type === 'income') d = 'income'
      else {
        const cd = t.category_id ? cats[t.category_id]?.division : undefined
        d = (cd && cd !== 'income') ? cd : 'variable'   // 未分類・区分不整合の支出は変動費に寄せる
      }
      ensure(d)[i] += t.amount
    }
    return acc
  })

  const incomeCells = $derived(matrix['income'] ?? zeros())
  const expenseRows = $derived(EXPENSE_DIVS.map(d => ({ label: DIVISION_LABELS[d], cells: matrix[d] ?? zeros() })))
  const expenseTotal = $derived(MONTHS.map((_, i) => EXPENSE_DIVS.reduce((s, d) => s + (matrix[d]?.[i] ?? 0), 0)))
  const netCells = $derived(MONTHS.map((_, i) => incomeCells[i] - expenseTotal[i]))

  const incomeYear = $derived(sum(incomeCells))
  const expenseYear = $derived(sum(expenseTotal))
  const netYear = $derived(incomeYear - expenseYear)
  const hasData = $derived(incomeYear !== 0 || expenseYear !== 0)

  async function load() {
    loading = true
    if (Object.keys(cats).length === 0) {
      const cl = await listCategories()
      cats = Object.fromEntries(cl.map(c => [c.id, c]))
    }
    // 年の12予算月をまとめて1クエリで取得（1月開始日 〜 12月の翌開始日）
    const start = budgetMonthRange(year, 1).start
    const end = budgetMonthRange(year, 12).end
    txs = await listTransactions(ymd(start), ymd(end))
    loading = false
  }
  onMount(load)

  function go(delta: number) { year += delta; load() }
  function cell(v: number) { return v ? yen(v) : '−' }
  function signed(v: number) { return (v < 0 ? '−' : '') + yen(Math.abs(v)) }
</script>

<div class="screen">
  <div class="month-nav">
    <button class="nav-btn" onclick={() => go(-1)} aria-label="前の年">‹</button>
    <span class="month-title">{year}年</span>
    <button class="nav-btn" onclick={() => go(1)} aria-label="次の年">›</button>
  </div>

  {#if loading}
    <p class="state">集計中…</p>
  {:else if !hasData}
    <p class="state">この年の収支データがありません。</p>
  {:else}
    <section class="summary">
      <div class="net-label">年間収支</div>
      <div class="net {netYear >= 0 ? 'pos' : 'neg'}">{netYear >= 0 ? '+' : '−'}{yen(Math.abs(netYear))}</div>
      <div class="io">
        <div class="io-cell"><span class="io-label">年間収入</span><span class="io-val pos">{yen(incomeYear)}</span></div>
        <div class="io-cell"><span class="io-label">年間支出</span><span class="io-val neg">{yen(expenseYear)}</span></div>
      </div>
    </section>

    <div class="year-scroll">
      <table class="year-table">
        <thead>
          <tr>
            <th>区分</th>
            {#each MONTHS as m}<th>{m}月</th>{/each}
            <th class="total">合計</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>収入</th>
            {#each incomeCells as v}<td class={v ? '' : 'z'}>{cell(v)}</td>{/each}
            <td class="total">{yen(incomeYear)}</td>
          </tr>
          {#each expenseRows as row}
            <tr>
              <th>{row.label}</th>
              {#each row.cells as v}<td class={v ? '' : 'z'}>{cell(v)}</td>{/each}
              <td class="total">{yen(sum(row.cells))}</td>
            </tr>
          {/each}
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
        </tbody>
      </table>
    </div>

    <p class="hint">予算月（{getMonthStartDay()}日始まり）で集計。振替は収支に含めません。横にスクロールできます。</p>
  {/if}
</div>
