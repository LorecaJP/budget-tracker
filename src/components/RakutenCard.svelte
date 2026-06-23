<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { listRakutenTx, updateRakutenCategoryByMerchant } from '../lib/db'
  import { RAKUTEN_CATEGORIES } from '../lib/rakuten/parse'
  import type { RakutenTx } from '../lib/types'
  import RakutenImport from './RakutenImport.svelte'

  let loading = $state(true)
  let rows = $state<RakutenTx[]>([])
  let sel = $state('')
  let open = $state<Record<string, boolean>>({})
  let showImport = $state(false)
  let editing = $state<{ merchant: string; category: string } | null>(null)

  const months = $derived([...new Set(rows.map(r => r.statement_month))].sort().reverse())
  const monthRows = $derived(rows.filter(r => r.statement_month === sel))
  const monthTotal = $derived(monthRows.reduce((s, r) => s + r.amount, 0))

  // 選択月：カテゴリ別（店明細つき）
  const monthCats = $derived.by(() => {
    const byCat = new Map<string, { total: number; merch: Map<string, number> }>()
    for (const r of monthRows) {
      const c = byCat.get(r.category) ?? { total: 0, merch: new Map() }
      c.total += r.amount
      c.merch.set(r.merchant, (c.merch.get(r.merchant) ?? 0) + r.amount)
      byCat.set(r.category, c)
    }
    return [...byCat.entries()]
      .map(([cat, v]) => ({ cat, total: v.total, merchants: [...v.merch.entries()].map(([m, t]) => ({ m, t })).sort((a, b) => b.t - a.t) }))
      .sort((a, b) => b.total - a.total)
  })

  // 年間サマリ（取り込んだ全月）：カテゴリ別 合計＋月平均
  const yearCats = $derived.by(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.category, (m.get(r.category) ?? 0) + r.amount)
    const n = Math.max(1, months.length)
    return [...m.entries()].map(([cat, total]) => ({ cat, total, avg: Math.round(total / n) })).sort((a, b) => b.total - a.total)
  })
  const yearTotal = $derived(rows.reduce((s, r) => s + r.amount, 0))

  async function load() {
    loading = true
    rows = await listRakutenTx()
    if (!sel || !months.includes(sel)) sel = months[0] ?? ''
    loading = false
  }
  onMount(load)

  async function saveCat(category: string) {
    if (!editing) return
    await updateRakutenCategoryByMerchant(editing.merchant, category)
    editing = null
    await load()
  }
</script>

<div class="screen">
  <h1 class="lg-title">楽天カード</h1>

  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if rows.length === 0}
    <div class="rk-empty">
      <div class="rk-empty-ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/></svg>
      </div>
      <p class="rk-empty-title">まだ明細がありません</p>
      <p class="rk-empty-sub">楽天e-NAVIの「ご利用代金請求明細書（PDF）」を取り込むと、何にいくら使ったかをカテゴリ別・月別・年間で見られます。</p>
      <button class="primary rk-empty-btn" onclick={() => showImport = true}>明細PDFを取り込む</button>
    </div>
  {:else}
    <button class="add-inline" onclick={() => showImport = true}>📄 利用明細PDFを取り込む</button>
    <div class="rk-months">
      {#each months as m}
        <button class="rk-chip {m === sel ? 'active' : ''}" onclick={() => sel = m}>{m.slice(5)}月</button>
      {/each}
    </div>

    <section class="summary">
      <div class="net-label">{sel.replace('-', '年')}月 ご請求</div>
      <div class="net neg">{yen(monthTotal)}</div>
    </section>

    <div class="sec-head">カテゴリ別（タップで店明細／店をタップで分類変更）</div>
    <section class="card">
      {#each monthCats as c (c.cat)}
        <div class="mb-row tappable" onclick={() => open[c.cat] = !open[c.cat]}>
          <div class="mb-head">
            <span class="mb-name">{open[c.cat] ? '▾' : '▸'} {c.cat}</span>
            <span class="mb-num"><b>{yen(c.total)}</b></span>
          </div>
          <div class="bp-track"><div class="bp-fill" style="width:{monthTotal > 0 ? (c.total / monthTotal) * 100 : 0}%"></div></div>
        </div>
        {#if open[c.cat]}
          {#each c.merchants as mc}
            <div class="mb-row rk-merch tappable" onclick={() => editing = { merchant: mc.m, category: c.cat }}>
              <div class="mb-head">
                <span class="mb-name">{mc.m}<span class="mb-edit">›</span></span>
                <span class="mb-num">{yen(mc.t)}</span>
              </div>
            </div>
          {/each}
        {/if}
      {/each}
    </section>

    <div class="sec-head">年間サマリ（取込済み {months.length}ヶ月・計 {yen(yearTotal)}）</div>
    <section class="card">
      {#each yearCats as c (c.cat)}
        <div class="budget-row">
          <span class="tx-name">{c.cat}</span>
          <span class="mb-num"><b>{yen(c.total)}</b> <span class="rk-avg">月平均 {yen(c.avg)}</span></span>
        </div>
      {/each}
    </section>
    <p class="hint">家計簿本体とは別管理（固定費の二重計上なし）。利用金額ベース。請求月ごとに置き換え。</p>
  {/if}
</div>

{#if showImport}
  <RakutenImport onclose={() => showImport = false} onsaved={() => { showImport = false; load() }} />
{/if}

{#if editing}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) editing = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => editing = null}>キャンセル</button><span class="sheet-title">分類を変更</span><span></span></div>
      <p class="hint">「{editing.merchant}」を別のカテゴリに（同じ店の明細すべてに適用）</p>
      {#each RAKUTEN_CATEGORIES as c}
        <button class="add-inline {c === editing.category ? 'rk-cur' : ''}" onclick={() => saveCat(c)}>{c}</button>
      {/each}
    </div>
  </div>
{/if}
