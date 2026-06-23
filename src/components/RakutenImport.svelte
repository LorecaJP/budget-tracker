<script lang="ts">
  import { extractPdfRows } from '../lib/payslip/extract'
  import { parseRakuten, type ParsedRakuten } from '../lib/rakuten/parse'
  import { replaceRakutenStatement } from '../lib/db'
  import { yen } from '../lib/month'

  let { onclose, onsaved }: { onclose: () => void; onsaved: () => void } = $props()

  let parsing = $state(false)
  let saving = $state(false)
  let error = $state('')
  let parsed = $state<ParsedRakuten | null>(null)
  // 再判定で上書き（手直しを無視し最新の自動分類で入れ直す）。選択はセッション間で保持。
  let recat = $state(localStorage.getItem('rk_recat') === '1')
  $effect(() => { localStorage.setItem('rk_recat', recat ? '1' : '0') })

  const catSummary = $derived.by(() => {
    if (!parsed) return [] as [string, number][]
    const m: Record<string, number> = {}
    for (const it of parsed.items) m[it.category] = (m[it.category] ?? 0) + it.amount
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  })

  async function pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    parsing = true; error = ''; parsed = null
    try {
      const { rows, text } = await extractPdfRows(f)
      const p = parseRakuten(rows, text)
      if (p.items.length === 0) error = '明細を読み取れませんでした（楽天カードの請求明細PDFか確認してください）'
      else if (!p.statement_month) error = '請求月を読み取れませんでした'
      else parsed = p
    } catch (err) {
      error = '読み取りに失敗しました：' + (err as Error).message
    } finally { parsing = false }
  }

  async function save() {
    if (!parsed) return
    saving = true
    const { error: e } = await replaceRakutenStatement(parsed.statement_month, parsed.items, recat)
    saving = false
    if (e) { error = '保存に失敗（rakuten_transactions テーブルの作成が必要かもしれません）：' + e.message; return }
    onsaved()
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head"><button class="link" onclick={onclose}>閉じる</button><span class="sheet-title">楽天カードを取り込む</span><span></span></div>

    <label class="add-inline">📄 利用明細PDFを選ぶ<input type="file" accept="application/pdf" onchange={pick} style="display:none" /></label>
    <p class="hint">楽天e-NAVIで出した「ご利用代金請求明細書（PDF）」を選んでください。1請求月ずつ。再取込すると同じ月は置き換わります。</p>

    {#if parsing}<p class="state">読み取り中…</p>{/if}
    {#if error}<p class="hint err">{error}</p>{/if}

    {#if parsed}
      <div class="card-label">{parsed.statement_month.replace('-', '年')}月 ご請求分</div>
      <div class="rk-total"><span class="rk-amt">{yen(parsed.total)}</span><span class="rk-cnt">{parsed.items.length}件</span></div>
      <div class="sec-head">カテゴリ別（自動分類）</div>
      <section class="card">
        {#each catSummary as [c, v]}
          <div class="budget-row"><span class="tx-name">{c}</span><span class="tx-amt neg">{yen(v)}</span></div>
        {/each}
      </section>
      <label class="hint" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:4px">
        <input type="checkbox" bind:checked={recat} />
        自動分類でやり直す（店ごとの手直しも上書き）
      </label>
      <button class="primary" onclick={save} disabled={saving}>{saving ? '登録中…' : 'この内容で登録'}</button>
      <p class="hint">カテゴリは取り込み後、「楽天カード」タブで店ごとに直せます。</p>
    {/if}
  </div>
</div>
