<script lang="ts">
  import { onMount } from 'svelte'
  import { yen, ymd } from '../lib/month'
  import { listAccounts, listCategories, listTransactions, insertTransaction } from '../lib/db'
  import type { Account, Category } from '../lib/types'
  import type { ParsedPayslip, PayslipDeduction } from '../lib/payslip/types'

  interface Props { onclose: () => void; onsaved: () => void }
  let { onclose, onsaved }: Props = $props()

  let accounts = $state<Account[]>([])
  let catByName = $state<Record<string, Category>>({})

  let parsing = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let dupWarning = $state<string | null>(null)
  let fileName = $state('')
  let parsed = $state<ParsedPayslip | null>(null)

  // 編集用フィールド
  let payDate = $state('')
  let person = $state('')
  let gross = $state<number | null>(null)
  let accountId = $state('')
  let deductions = $state<PayslipDeduction[]>([])
  let memo = $state('')

  const totalDeduction = $derived(deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0))
  const net = $derived((Number(gross) || 0) - totalDeduction)
  const incomeCatName = $derived(person === 'えみ' ? 'えみ給料' : person === 'ゆうき' ? 'ゆうき給料' : '')

  onMount(async () => {
    accounts = await listAccounts()
    const cats = await listCategories()
    catByName = Object.fromEntries(cats.map(c => [c.name, c]))
  })

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    error = null; dupWarning = null; parsing = true; fileName = file.name
    try {
      const { extractPdfText } = await import('../lib/payslip/extract')
      const { parsePayslipText } = await import('../lib/payslip/parse')
      const { text, hasTextLayer } = await extractPdfText(file)
      if (!hasTextLayer) {
        error = 'このPDFにはテキストがありません（スキャン画像）。スキャン明細のOCR対応は別途実装予定です。'
        return
      }
      const p = parsePayslipText(text)
      parsed = p
      payDate = p.payDate ?? ''
      person = p.person ?? ''
      gross = p.gross
      deductions = p.deductions.map(d => ({ ...d }))
      memo = [p.periodLabel, p.base ? `基本給${p.base.toLocaleString('ja-JP')}` : '', p.commute ? `通勤手当${p.commute.toLocaleString('ja-JP')}` : '']
        .filter(Boolean).join(' / ')
      const bank = accounts.find(a => a.type === 'bank') ?? accounts[0]
      if (bank) accountId = bank.id
      await checkDuplicate()
    } catch (err) {
      error = '読み取りに失敗しました：' + (err instanceof Error ? err.message : String(err))
    } finally {
      parsing = false
    }
  }

  async function checkDuplicate() {
    if (!payDate || !gross) return
    const [y, m, d] = payDate.split('-').map(Number)
    const endISO = ymd(new Date(y, m - 1, d + 1))
    const existing = await listTransactions(payDate, endISO, { type: 'income' })
    if (existing.some(t => t.amount === gross && t.person === (person || null))) {
      dupWarning = 'この明細は既に取り込み済みかもしれません（同日・同額の収入が存在します）。'
    }
  }

  function addDeduction() { deductions = [...deductions, { label: '', amount: 0 }] }
  function removeDeduction(i: number) { deductions = deductions.filter((_, j) => j !== i) }

  async function save() {
    error = null
    if (!gross || gross <= 0) { error = '総支給額を入力してください'; return }
    if (!payDate) { error = '支給日を入力してください'; return }
    saving = true
    const p = person || null
    const acc = accountId || null
    const reqs = [
      insertTransaction({ date: payDate, amount: Math.round(gross), type: 'income',
        category_id: catByName[incomeCatName]?.id ?? null, account_id: acc, person: p, memo, source: 'ocr' }),
    ]
    for (const d of deductions) {
      const amt = Math.round(Number(d.amount) || 0)
      if (amt <= 0) continue
      reqs.push(insertTransaction({ date: payDate, amount: amt, type: 'expense',
        category_id: catByName[d.label]?.id ?? null, account_id: acc, person: p, memo: d.label || '控除', source: 'ocr' }))
    }
    const results = await Promise.all(reqs)
    saving = false
    const failed = results.find(r => r.error)
    if (failed?.error) { error = '登録に失敗しました：' + failed.error.message; return }
    onsaved()
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose() }} />
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="給与PDF取込">
    <div class="sheet-head">
      <button class="link" onclick={onclose}>キャンセル</button>
      <strong>給与PDF取込</strong>
      <span style="width:64px"></span>
    </div>

    {#if !parsed}
      <p class="hint">給与明細のPDFを選ぶと、項目を自動で読み取ります（テキストPDFのみ。スキャンは後日OCR対応）。</p>
      <label class="add-inline" style="display:block; text-align:center; cursor:pointer">
        📄 PDFを選択
        <input type="file" accept="application/pdf,.pdf" onchange={onFile} style="display:none" />
      </label>
      {#if parsing}<p class="state">読み取り中…</p>{/if}
      {#if error}<p class="msg error">{error}</p>{/if}
    {:else}
      {#if dupWarning}<p class="msg notice">⚠️ {dupWarning}</p>{/if}
      <p class="hint">{fileName}{parsed.periodLabel ? ' · ' + parsed.periodLabel : ''} · 様式 {parsed.format}</p>

      <div class="row2">
        <label class="field"><span>支給日</span><input type="date" bind:value={payDate} /></label>
        <label class="field"><span>人</span>
          <select bind:value={person}>
            <option value="">指定なし</option>
            <option value="ゆうき">ゆうき</option>
            <option value="えみ">えみ</option>
          </select>
        </label>
      </div>

      <label class="field"><span>総支給額（収入 → {incomeCatName || '未指定カテゴリ'}）</span>
        <input type="number" inputmode="numeric" bind:value={gross} />
      </label>
      <label class="field"><span>入金口座</span>
        <select bind:value={accountId}>
          <option value="">未指定</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>

      <div class="day-head"><span>控除（tax区分の支出として記録）</span></div>
      {#each deductions as d, i (i)}
        <div class="ded-row">
          <input class="ded-label" type="text" bind:value={d.label} placeholder="項目名（例: 所得税）" />
          <input class="budget-input" type="number" inputmode="numeric" bind:value={d.amount} />
          <button class="link" onclick={() => removeDeduction(i)}>削除</button>
        </div>
        <p class="ded-cat">→ {catByName[d.label] ? d.label + '（tax）' : '未マッチ：区分なしで記録'}</p>
      {/each}
      <button class="add-inline" onclick={addDeduction}>＋ 控除を追加</button>

      <div class="reserve"><span>差引支給額（手取り）</span><span class="num">{yen(net)}</span></div>

      {#if error}<p class="msg error">{error}</p>{/if}
      <button class="primary" onclick={save} disabled={saving}>{saving ? '登録中…' : '確定して登録'}</button>
      <p class="hint">総支給を収入1件、各控除を支出として登録します（取込元: source=ocr）。</p>
    {/if}
  </div>
</div>
