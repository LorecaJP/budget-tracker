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

  // ── 節約ウォッチ（減らしたい店を請求月ごとに見える化）。設定は localStorage に保持。──
  type WatchGroup = { label: string; keywords: string[]; target: number | null }
  const DEFAULT_WATCH: WatchGroup[] = [
    { label: 'コンビニ', keywords: ['ファミリーマート', 'ﾌｱﾐﾘ-ﾏ-ﾄ', 'ローソン', 'ﾛ-ｿﾝ', 'セブン', 'ｾﾌﾞﾝ'], target: null },
    { label: 'スタバ', keywords: ['ｽﾀ-ﾊﾞﾂｸｽ', 'スターバックス'], target: null },
    { label: 'DMM', keywords: ['DMM'], target: null },
  ]
  function loadWatch(): WatchGroup[] {
    try { const raw = localStorage.getItem('rk_watch'); if (raw) return JSON.parse(raw) } catch { /* noop */ }
    return DEFAULT_WATCH
  }
  let watch = $state<WatchGroup[]>(loadWatch())
  let editWatch = $state(false)
  // 編集はキーワードを文字列で扱うドラフトで行う（配列に即変換すると入力中に「,」が消えて打てない）。
  let draft = $state<{ label: string; kw: string; target: number | null }[]>([])
  function openWatchEdit() {
    draft = watch.map(g => ({ label: g.label, kw: g.keywords.join(', '), target: g.target }))
    editWatch = true
  }
  function commitWatch() {
    watch = draft
      .map(d => ({ label: d.label.trim(), keywords: d.kw.split(',').map(s => s.trim()).filter(Boolean), target: d.target ?? null }))
      .filter(g => g.label || g.keywords.length)
    localStorage.setItem('rk_watch', JSON.stringify(watch))
    editWatch = false
  }

  // 選択月の1つ前（chips は新しい順なので index+1）
  const prevMonth = $derived.by(() => {
    const i = months.indexOf(sel)
    return i >= 0 && i + 1 < months.length ? months[i + 1] : ''
  })
  function groupSum(kw: string[], month: string) {
    let total = 0, cnt = 0
    for (const r of rows) {
      if (r.statement_month !== month) continue
      if (kw.some(k => k && r.merchant.includes(k))) { total += r.amount; cnt++ }
    }
    return { total, cnt }
  }
  const watchRows = $derived.by(() => watch.map(g => {
    const cur = groupSum(g.keywords, sel)
    const prev = prevMonth ? groupSum(g.keywords, prevMonth).total : null
    let allTotal = 0
    for (const r of rows) if (g.keywords.some(k => k && r.merchant.includes(k))) allTotal += r.amount
    const avg = months.length ? Math.round(allTotal / months.length) : 0
    return { label: g.label, target: g.target, cur: cur.total, cnt: cur.cnt, prev, delta: prev == null ? null : cur.total - prev, year: avg * 12 }
  }))
  const watchCur = $derived(watchRows.reduce((s, w) => s + w.cur, 0))
  const watchPrev = $derived(watchRows.reduce((s, w) => s + (w.prev ?? 0), 0))
  const watchYear = $derived(watchRows.reduce((s, w) => s + w.year, 0))

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

    <div class="sec-head">節約ウォッチ<button class="link rkw-edit-btn" onclick={openWatchEdit}>編集</button></div>
    {#if watchRows.length > 0}
      <section class="card">
        <div class="rkw-top">
          <div>
            <div class="rkw-top-label">{sel.slice(5)}月の合計</div>
            <div class="rkw-top-amt">{yen(watchCur)}</div>
          </div>
          <div class="rkw-top-right">
            {#if prevMonth}
              <div class="rkw-delta {watchCur <= watchPrev ? 'rk-down' : 'rk-up'}">前月 {yen(watchPrev)} → {watchCur <= watchPrev ? '▼' : '▲'}{yen(Math.abs(watchCur - watchPrev))}</div>
            {/if}
            <div class="rk-avg">この調子で年 {yen(watchYear)}</div>
          </div>
        </div>
        {#each watchRows as w (w.label)}
          <div class="mb-row">
            <div class="mb-head">
              <span class="mb-name">{w.label} <span class="rk-avg">{w.cnt}回</span></span>
              <span class="mb-num"><b>{yen(w.cur)}</b>{#if w.delta != null}<span class="rkw-d {w.delta <= 0 ? 'rk-down' : 'rk-up'}">{w.delta <= 0 ? '▼' : '▲'}{yen(Math.abs(w.delta))}</span>{/if}</span>
            </div>
            {#if w.target}
              <div class="bp-track"><div class="bp-fill {w.cur > w.target ? 'over' : 'green'}" style="width:{Math.min(100, w.target > 0 ? (w.cur / w.target) * 100 : 0)}%"></div></div>
              <div class="rk-avg">目標 {yen(w.target)} / {w.cur > w.target ? `${yen(w.cur - w.target)} 超過` : `残り ${yen(w.target - w.cur)}`}</div>
            {/if}
          </div>
        {/each}
        <p class="hint">減らしたい店の請求月ごとの合計。前月より減ると緑▼。「編集」で店や目標を変えられます。</p>
      </section>
    {/if}

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

{#if editWatch}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) commitWatch() }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={commitWatch}>閉じる</button><span class="sheet-title">節約ウォッチの編集</span><span></span></div>
      <p class="hint">減らしたい店をグループで登録。キーワードは店名の一部（カンマ区切り、半角ｶﾅ/全角どちらもOK・複数可）。目標は1ヶ月あたりの上限（任意）。</p>
      {#each draft as d, i (i)}
        <section class="card rkw-edit">
          <input class="rkw-in" placeholder="ラベル（例: コンビニ）" bind:value={d.label} />
          <input class="rkw-in" placeholder="キーワード（例: ファミリーマート, ﾛ-ｿﾝ, セブン）" bind:value={d.kw} />
          <input class="rkw-in" type="number" inputmode="numeric" placeholder="月の目標額（任意・円）" bind:value={d.target} />
          <button class="link rkw-del" onclick={() => draft = draft.filter((_, j) => j !== i)}>このグループを削除</button>
        </section>
      {/each}
      <button class="add-inline" onclick={() => draft = [...draft, { label: '', kw: '', target: null }]}>＋ グループを追加</button>
      <button class="link" onclick={() => draft = DEFAULT_WATCH.map(g => ({ label: g.label, kw: g.keywords.join(', '), target: g.target }))}>既定（コンビニ/スタバ/DMM）に戻す</button>
    </div>
  </div>
{/if}
