<script lang="ts">
  import { onMount } from 'svelte'
  import { yen, ymd, budgetMonthOf } from '../lib/month'
  import { listAccounts, listCategories, listTransactions, insertTransaction, upsertPayslipDetail, deleteOcrPayslipTx } from '../lib/db'
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
  let selectedFile = $state<File | null>(null)
  let needsOcr = $state(false)   // テキスト層なし＝スキャン → クラウドOCRが必要
  let ocrRunning = $state(false)

  // 編集用フィールド
  let payDate = $state('')
  let person = $state('')
  let gross = $state<number | null>(null)
  let accountId = $state('')
  let deductions = $state<PayslipDeduction[]>([])
  let memo = $state('')
  let statedNet = $state<number | null>(null)   // 明細記載の差引支給額（計算値との照合用）
  let kind = $state<'salary' | 'bonus'>('salary')
  // 扶養トラッカー用の追加項目（通勤手当・総労働時間）。
  // ※課税支給額は明細上「年内累計」なので取り込まない（扶養タブで 総支給−通勤手当 として算出）。
  let commute = $state<number | null>(null)
  let workTime = $state('')                      // 「HH:MM」または時間数で入力

  // 「HH:MM」/「86」/「86.5」などを分に変換
  function parseWorkMinutes(s: string): number | null {
    const t = s.trim()
    if (!t) return null
    const c = t.match(/^(\d{1,3})[:：](\d{1,2})$/)
    if (c) return Number(c[1]) * 60 + Number(c[2])
    const n = Number(t.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 60) : null
  }
  function fmtWorkTime(min: number | null): string {
    if (min == null) return ''
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
  }

  const totalDeduction = $derived(deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0))
  const net = $derived((Number(gross) || 0) - totalDeduction)
  const incomeCatName = $derived(
    kind === 'bonus' ? 'ボーナス' : person === 'えみ' ? 'えみ給料' : person === 'ゆうき' ? 'ゆうき給料' : ''
  )
  // 計上される予算月（支給日から動的に算出。手修正にも追従）
  const budgetMonth = $derived.by(() => {
    const m = payDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const bm = budgetMonthOf(new Date(+m[1], +m[2] - 1, +m[3]))
    return `${bm.year}年${bm.month}月`
  })

  onMount(async () => {
    accounts = await listAccounts()
    const cats = await listCategories()
    catByName = Object.fromEntries(cats.map(c => [c.name, c]))
  })

  // 計上日を25日始まりの境界に合わせて補正する（手修正可）。
  //  - 給料（25日払い）: 休日で前の平日（22〜24日）に前倒しされたら25日に。
  //  - 賞与（20日払い）: 同月の25日給料と同じ予算月になるよう25日に。
  function normalizePayday(iso: string, k: 'salary' | 'bonus'): string {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return iso
    const day = Number(m[3])
    const to25 = `${m[1]}-${m[2]}-25`
    if (k === 'bonus') return day !== 25 ? to25 : iso
    if (day >= 22 && day <= 24) return to25
    return iso
  }

  function applyParsed(p: ParsedPayslip) {
    parsed = p
    kind = p.kind
    payDate = p.payDate ? normalizePayday(p.payDate, p.kind) : ''
    person = p.person ?? ''
    gross = p.gross
    statedNet = p.net
    deductions = p.deductions.map(d => ({ ...d }))
    memo = [p.periodLabel, p.base ? `基本給${p.base.toLocaleString('ja-JP')}` : '', p.commute ? `通勤手当${p.commute.toLocaleString('ja-JP')}` : '']
      .filter(Boolean).join(' / ')
    commute = p.commute
    workTime = fmtWorkTime(p.workMinutes)
    const bank = accounts.find(a => a.type === 'bank') ?? accounts[0]
    if (bank) accountId = bank.id
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    error = null; dupWarning = null; needsOcr = false; parsing = true; fileName = file.name; selectedFile = file
    try {
      const { extractPdfText } = await import('../lib/payslip/extract')
      const { parsePayslipText } = await import('../lib/payslip/parse')
      const { text, hasTextLayer } = await extractPdfText(file)
      if (!hasTextLayer) {
        needsOcr = true   // スキャン → OCRボタンを出す（エラーにしない）
        return
      }
      applyParsed(parsePayslipText(text))
      await checkDuplicate()
    } catch (err) {
      error = '読み取りに失敗しました：' + (err instanceof Error ? err.message : String(err))
    } finally {
      parsing = false
    }
  }

  async function runOcr() {
    if (!selectedFile) return
    error = null; ocrRunning = true
    try {
      const { renderPdfFirstPage } = await import('../lib/payslip/extract')
      const { ocrPayslipImage } = await import('../lib/payslip/ocr')
      const image = await renderPdfFirstPage(selectedFile)
      applyParsed(await ocrPayslipImage(image))
      await checkDuplicate()
    } catch (err) {
      error = 'OCRに失敗しました：' + (err instanceof Error ? err.message : String(err))
    } finally {
      ocrRunning = false
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
    // 再取込（同じ人・支給日・種別）は前回分を置き換える＝二重登録を防ぐ。
    // memo にマーカーを付け、保存前に同マーカー（と旧マーカー無しの同人・同日OCR）を削除する。
    const marker = `#ps:${p ?? '-'}:${payDate}:${kind}`
    await deleteOcrPayslipTx(payDate, p, marker)
    const reqs = [
      insertTransaction({ date: payDate, amount: Math.round(gross), type: 'income',
        category_id: catByName[incomeCatName]?.id ?? null, account_id: acc, person: p, memo: `${memo} ${marker}`.trim(), source: 'ocr' }),
    ]
    for (const d of deductions) {
      const amt = Math.round(Number(d.amount) || 0)
      if (amt === 0) continue
      if (amt > 0) {
        // 控除 = tax区分の支出として記録
        reqs.push(insertTransaction({ date: payDate, amount: amt, type: 'expense',
          category_id: catByName[d.label]?.id ?? null, account_id: acc, person: p, memo: `${d.label || '控除'} ${marker}`, source: 'ocr' }))
      } else {
        // マイナス控除（年末調整還付など）＝ 還付。金額は正にして収入として記録する。
        reqs.push(insertTransaction({ date: payDate, amount: -amt, type: 'income',
          category_id: catByName[d.label]?.id ?? null, account_id: acc, person: p, memo: `${d.label || '還付'} ${marker}`, source: 'ocr' }))
      }
    }
    const results = await Promise.all(reqs)
    const failed = results.find(r => r.error)
    if (failed?.error) { saving = false; error = '登録に失敗しました：' + failed.error.message; return }
    // 扶養トラッカー用の追加項目を保存（テーブル未作成でも本体登録は成功させる＝ベストエフォート）
    if (kind === 'salary' && p) {
      await upsertPayslipDetail({
        person: p, pay_date: payDate, gross: Math.round(gross),
        taxable: null,   // 課税支給額は累計値のため保存しない（扶養タブで 総支給−通勤手当 で算出）
        commute: commute != null ? Math.round(commute) : null,
        work_minutes: parseWorkMinutes(workTime),
      })
    }
    saving = false
    onsaved()
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose() }} />
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="給与PDF取込">
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <button class="link" onclick={onclose}>キャンセル</button>
      <strong>給与PDF取込</strong>
      <span style="width:64px"></span>
    </div>

    {#if !parsed}
      {#if needsOcr}
        <p class="hint">スキャンPDF（テキストなし）です。クラウドOCR（Azure）で読み取ります。<br />{fileName}</p>
        <button class="add-inline" onclick={runOcr} disabled={ocrRunning}>{ocrRunning ? 'OCR実行中…（数秒かかります）' : '☁️ クラウドOCRで読み取る'}</button>
        {#if error}<p class="msg error">{error}</p>{/if}
      {:else}
        <p class="hint">給与明細のPDFを選ぶと、項目を自動で読み取ります（テキストPDFは即時、スキャンはクラウドOCR）。</p>
        <label class="add-inline" style="display:block; text-align:center; cursor:pointer">
          📄 PDFを選択
          <input type="file" accept="application/pdf,.pdf" onchange={onFile} style="display:none" />
        </label>
        {#if parsing}<p class="state">読み取り中…</p>{/if}
        {#if error}<p class="msg error">{error}</p>{/if}
      {/if}
    {:else}
      {#if dupWarning}<p class="msg notice">⚠️ {dupWarning}</p>{/if}
      <p class="hint">{fileName}{parsed.periodLabel ? ' · ' + parsed.periodLabel : ''} · 様式 {parsed.format}</p>

      <label class="field"><span>支給日</span><input type="date" bind:value={payDate} /></label>
      <label class="field"><span>人</span>
        <select bind:value={person}>
          <option value="">指定なし</option>
          <option value="ゆうき">ゆうき</option>
          <option value="えみ">えみ</option>
        </select>
      </label>
      {#if budgetMonth}<p class="hint">計上先：<b>{budgetMonth}の予算月</b></p>{/if}

      <label class="field"><span>総支給額（収入 → {incomeCatName || '未指定カテゴリ'}）</span>
        <input type="number" inputmode="numeric" bind:value={gross} />
      </label>
      <label class="field"><span>入金口座</span>
        <select bind:value={accountId}>
          <option value="">未指定</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>

      <div class="day-head"><span>扶養トラッカー用（えみの集計・任意）</span></div>
      <div class="row2">
        <label class="field"><span>通勤手当</span><input type="number" inputmode="numeric" bind:value={commute} /></label>
        <label class="field"><span>総労働時間（例 86:21）</span><input type="text" inputmode="numeric" bind:value={workTime} placeholder="HH:MM" /></label>
      </div>
      <p class="hint">課税支給額は「総支給−通勤手当」で自動計算します（明細の課税支給額は年内累計のため使いません）。</p>

      <div class="day-head"><span>控除（プラス＝支出 / マイナス＝還付は収入）</span></div>
      {#each deductions as d, i (i)}
        <div class="ded-row">
          <input class="ded-label" type="text" bind:value={d.label} placeholder="項目名（例: 所得税）" />
          <input class="budget-input" type="number" inputmode="numeric" bind:value={d.amount} />
          <button class="link" onclick={() => removeDeduction(i)}>削除</button>
        </div>
        <p class="ded-cat">
          {#if Number(d.amount) < 0}
            → マイナス＝還付。<b>収入</b>として記録します（差引支給額に加算）。
          {:else}
            → {catByName[d.label] ? d.label + '（tax）' : '未マッチ：区分なしで記録'}
          {/if}
        </p>
      {/each}
      <button class="add-inline" onclick={addDeduction}>＋ 控除を追加</button>

      <div class="reserve"><span>差引支給額（総支給−控除）</span><span class="num">{yen(net)}</span></div>
      {#if statedNet != null && statedNet !== net}
        <p class="msg notice">⚠️ 明細記載の差引支給額（{yen(statedNet)}）と計算値（{yen(net)}）が一致しません。金額を確認してください。</p>
      {/if}

      {#if error}<p class="msg error">{error}</p>{/if}
      <button class="primary" onclick={save} disabled={saving}>{saving ? '登録中…' : '確定して登録'}</button>
    {/if}
  </div>
</div>
