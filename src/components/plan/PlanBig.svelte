<script lang="ts">
  // 作り替え§12 ③「大きな支払い」：項目ごとに、払う日・何月の給料で払うか・金額・積立済み/あと・毎月の積立を見る画面。
  // データは special_expenses（大きな支払い）と fund_uses（貯金から当てた額）。計算は allocation.ts の summarizeBigs。
  import { onMount } from 'svelte'
  import './plan.css'
  import { portal } from '../../lib/portal'
  import { session } from '../../lib/session'
  import { getMonthStartDay } from '../../lib/month'
  import {
    loadPlanInput, upsertSpecialExpense, deleteSpecialExpense, saveFundUse, deleteFundUse, listAccounts,
  } from '../../lib/db'
  import {
    summarizeBigs, periodOfDate, shiftKey, keyDiff, parseKey, bigDate, trackBig,
    type PlanInput, type BigPayment, type BigSummary, type Repeat,
  } from '../../lib/plan/allocation'
  import type { Account } from '../../lib/types'

  const startDay = getMonthStartDay()
  const WD = ['日', '月', '火', '水', '木', '金', '土']
  function todayISO() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const today = todayISO()
  const currentKey = periodOfDate(today, startDay)
  const nextKey = shiftKey(currentKey, 1)

  let inp = $state<PlanInput | null>(null)
  let accounts = $state<Account[]>([])
  let loading = $state(true)
  let busy = $state(false)
  let toast = $state('')
  let showPast = $state(false)

  async function reload() {
    const [p, a] = await Promise.all([loadPlanInput(startDay, today), listAccounts()])
    inp = p; accounts = a; loading = false
  }
  onMount(reload)
  function flash(t: string) { toast = t; setTimeout(() => { if (toast === t) toast = '' }, 2200) }
  const yen = (n: number) => (n < 0 ? '−¥' : '¥') + Math.abs(Math.round(n)).toLocaleString('ja-JP')
  const wd = (iso: string) => WD[new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()]
  const dateText = (b: BigPayment) => b.due_day
    ? `${b.year}年${b.planned_month}月${b.due_day}日（${wd(bigDate(b))}）`
    : `${b.year}年${b.planned_month}月（日にち未定）`
  const payLabel = (key: string) => `${parseKey(key).m}月${startDay}日の給料`

  const all = $derived<BigSummary[]>(inp ? summarizeBigs(inp, currentKey) : [])
  // これから（払う月が今の月以降）＝積立するもの／しないもの、過去
  const upcoming = $derived(all.filter(s => keyDiff(currentKey, s.payKey) >= 0 && s.big.is_reserved))
  const notReserved = $derived(all.filter(s => keyDiff(currentKey, s.payKey) >= 0 && !s.big.is_reserved))
  const past = $derived(all.filter(s => keyDiff(currentKey, s.payKey) < 0).reverse())
  const within = $derived(upcoming.filter(s => keyDiff(s.payKey, shiftKey(currentKey, 12)) > 0))
  const total = $derived(within.reduce((a, s) => a + s.big.budget_amount, 0))
  const saved = $derived(within.reduce((a, s) => a + s.saved, 0))
  // 次の給料の月に積み立てる額（行の割り当てがあればその額、無ければ必要額）
  const nextSum = $derived.by(() => {
    if (!inp) return 0
    let n = 0
    for (const s of upcoming) {
      const t = trackBig(s.big, inp)
      const line = inp.lines.find(l => l.period_month === nextKey && l.kind === 'big' && l.special_id === s.big.id)
      n += line?.allocated ?? t.need.get(nextKey) ?? 0
    }
    return n
  })
  function planText(s: BigSummary): string {
    if (s.rest <= 0) return '積立は済んでいます'
    if (s.times <= 0) return '払う月を過ぎています'
    const enough = s.monthly * s.times >= s.rest
    return `毎月 ${yen(s.monthly)} × ${s.times}回${enough ? 'で間に合います' : `（${yen(s.rest - s.monthly * s.times)} 不足）`}${s.big.monthly_amount != null ? '・手入力' : ''}`
  }
  const fundOf = (id: string) => inp?.funds.filter(f => f.special_id === id) ?? []

  // ---------- 追加・編集 ----------
  let open = $state(false)
  let eId = $state<string | null>(null)
  let eName = $state(''), eAmt = $state(''), eYear = $state(''), eMonth = $state(1), eDay = $state('')
  let eRepeat = $state<Repeat>('once'), eReserved = $state(true), eMonthly = $state(''), eOpening = $state('')
  let eFund = $state(''), eFundAcc = $state<string | null>(null)
  let eAuto = $state(0)
  const savingsAccounts = $derived(accounts.filter(a => !a.archived && a.role === 'savings'))
  const num = (v: string) => { const d = String(v ?? '').replace(/[^0-9]/g, ''); return d === '' ? null : Number(d) }

  function openEdit(s?: BigSummary) {
    open = true
    const b = s?.big
    eId = b?.id ?? null
    eName = b?.name ?? ''
    eAmt = b ? String(b.budget_amount) : ''
    eYear = String(b?.year ?? Number(today.slice(0, 4)))
    eMonth = b?.planned_month ?? Number(today.slice(5, 7))
    eDay = b?.due_day ? String(b.due_day) : ''
    eRepeat = b?.repeat ?? 'once'
    eReserved = b?.is_reserved ?? true
    eMonthly = b?.monthly_amount != null ? String(b.monthly_amount) : ''
    eOpening = b?.saved_opening ? String(b.saved_opening) : ''
    const f = b ? fundOf(b.id) : []
    eFund = f.length ? String(f.reduce((a, x) => a + x.amount, 0)) : ''
    eFundAcc = f[0]?.account_id ?? savingsAccounts[0]?.id ?? null
    eAuto = s?.monthly ?? 0
  }
  async function save() {
    const amt = num(eAmt), year = num(eYear), day = num(eDay)
    if (!eName.trim() || !amt || !year) { flash('名前・金額・年を入れてください'); return }
    if (day != null && (day < 1 || day > 31)) { flash('日は1〜31で入れてください'); return }
    busy = true
    const row = {
      name: eName.trim(), budget_amount: amt, year, planned_month: eMonth, due_day: day,
      repeat: eRepeat, is_reserved: eReserved, monthly_amount: num(eMonthly), saved_opening: num(eOpening) ?? 0,
    }
    const res = eId
      ? await upsertSpecialExpense({ id: eId, ...row })
      : await upsertSpecialExpense({ ...row, user_id: $session?.user.id, actual_amount: null })
    if (res.error) { busy = false; flash('保存できませんでした：' + res.error.message); return }
    // 貯金から当てた額（この項目に1件として持つ）
    if (eId) {
      const f = fundOf(eId), v = num(eFund) ?? 0
      if (v > 0) await saveFundUse({ id: f[0]?.id, period_month: f[0]?.period_month ?? currentKey, account_id: eFundAcc, special_id: eId, amount: v })
      for (const x of (v > 0 ? f.slice(1) : f)) if (x.id) await deleteFundUse(x.id)
    }
    busy = false; open = false
    await reload()
    flash('保存しました')
  }
  async function remove() {
    if (!eId || !confirm(`「${eName}」を消しますか？（積立の割り当ても消えます）`)) return
    busy = true
    await deleteSpecialExpense(eId)
    busy = false; open = false
    await reload()
    flash('消しました')
  }
  // 毎年・2年ごとの項目の次の分を作る
  async function makeNext() {
    const year = num(eYear), amt = num(eAmt)
    if (!year || !amt) return
    const step = eRepeat === 'every2y' ? 2 : 1
    busy = true
    const res = await upsertSpecialExpense({
      user_id: $session?.user.id, name: eName.trim(), budget_amount: amt, year: year + step, planned_month: eMonth,
      due_day: num(eDay), repeat: eRepeat === 'once' ? 'yearly' : eRepeat, is_reserved: eReserved,
      monthly_amount: null, saved_opening: 0, actual_amount: null,
    })
    busy = false
    if (res.error) { flash('作れませんでした：' + res.error.message); return }
    open = false
    await reload()
    flash(`${year + step}年の分を作りました`)
  }
</script>

<div class="pm">
  {#if loading}
    <p class="state">読み込み中…</p>
  {:else}
    <div class="titlebar"><h1>大きな支払い</h1></div>

    <div class="quad">
      <div><span class="cap">1年以内の合計</span><span class="qv">{yen(total)}</span></div>
      <div><span class="cap">積立済み</span><span class="qv">{yen(saved)}</span></div>
      <div><span class="cap">あと</span><span class="qv">{yen(Math.max(0, total - saved))}</span></div>
      <div><span class="cap">次の給料で積み立てる</span><span class="qv tint">{yen(nextSum)}</span></div>
    </div>

    <span class="sechead">払う日の順</span>
    <div class="list">
      {#each upcoming as s, i}
        <button class="row" class:first={i === 0} onclick={() => openEdit(s)}>
          <span class="line col">
            <span class="top">
              <span class="main"><span class="name strong">{s.big.name}</span><span class="sub2">{dateText(s.big)}・{payLabel(s.payKey)}で払う</span></span>
              <span class="amt strong">{yen(s.big.budget_amount)}</span>
            </span>
            <span class="pbar"><span style="width: {Math.min(100, Math.round(s.saved / Math.max(1, s.big.budget_amount) * 100))}%"></span></span>
            <span class="top small">
              <span class="sub2">積立済み {yen(s.saved)}</span>
              <span class="st {s.rest > 0 ? 'strongt' : 'ok'}">{s.rest > 0 ? `あと ${yen(s.rest)}` : '用意済み'}</span>
            </span>
            <span class="sub2">{fundOf(s.big.id).length ? `貯金から ${yen(fundOf(s.big.id).reduce((a, f) => a + f.amount, 0))}・` : ''}{planText(s)}</span>
          </span>
        </button>
      {:else}
        <div class="row first"><span class="line muted">これからの大きな支払いはありません</span></div>
      {/each}
      <button class="row action" onclick={() => openEdit()}><span class="line">大きな支払いを追加</span></button>
    </div>
    <span class="foot pad">毎月の積立額は、残りの額を払う月までの回数で割って出します。積み立てた額は「今月」で割り当てると増えます。</span>

    {#if notReserved.length}
      <span class="sechead">積み立てない支払い</span>
      <div class="list">
        {#each notReserved as s, i}
          <button class="row" class:first={i === 0} onclick={() => openEdit(s)}>
            <span class="line">
              <span class="main"><span class="name">{s.big.name}</span><span class="sub2">{dateText(s.big)}</span></span>
              <span class="amt">{yen(s.big.budget_amount)}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}

    {#if past.length}
      <span class="sechead">過去の支払い</span>
      <div class="list">
        <button class="row action first" onclick={() => showPast = !showPast}><span class="line">{showPast ? '閉じる' : `${past.length}件を見る`}</span></button>
        {#if showPast}
          {#each past as s}
            <button class="row" onclick={() => openEdit(s)}>
              <span class="line">
                <span class="main"><span class="name">{s.big.name}</span><span class="sub2">{dateText(s.big)}{s.big.repeat !== 'once' ? (s.big.repeat === 'yearly' ? '・毎年' : '・2年ごと') : ''}</span></span>
                <span class="right"><span class="amt">{yen(s.big.actual_amount ?? s.big.budget_amount)}</span><span class="st sec">{s.big.is_reserved ? '積立' : '積み立てない'}</span></span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
      <span class="foot pad">毎年ある支払いは、開いて「次の分を作る」を押すと、来年の分ができます。</span>
    {/if}
  {/if}
</div>

{#if toast}<div class="pm-toast" use:portal>{toast}</div>{/if}

{#if open}
  <div class="pm-back" use:portal onclick={(e) => { if (e.target === e.currentTarget) open = false }} role="presentation">
    <div class="pm-sheet">
      <div class="grab"></div>
      <div class="nav">
        <button class="navbtn" onclick={() => open = false}>キャンセル</button>
        <span class="navtitle">{eId ? '大きな支払い' : '大きな支払いを追加'}</span>
        <button class="navbtn strong" disabled={busy} onclick={save}>保存</button>
      </div>
      <div class="list sheetlist">
        <label class="row first"><span class="line"><span class="flabel">名前</span><input class="text" placeholder="例：車検、自動車税" bind:value={eName} /></span></label>
        <label class="row"><span class="line"><span class="flabel">金額</span><input class="strong" inputmode="numeric" placeholder="¥0" bind:value={eAmt} /></span></label>
        <label class="row"><span class="line"><span class="flabel">年</span><input inputmode="numeric" bind:value={eYear} /></span></label>
        <label class="row"><span class="line"><span class="flabel">月</span>
          <select bind:value={eMonth}>{#each Array.from({ length: 12 }, (_, i) => i + 1) as mm}<option value={mm}>{mm}月</option>{/each}</select>
        </span></label>
        <label class="row"><span class="line"><span class="flabel">日</span><input inputmode="numeric" placeholder="未定" bind:value={eDay} /></span></label>
      </div>
      <div class="seg3">
        <button class:on={eRepeat === 'once'} onclick={() => eRepeat = 'once'}>1回だけ</button>
        <button class:on={eRepeat === 'yearly'} onclick={() => eRepeat = 'yearly'}>毎年</button>
        <button class:on={eRepeat === 'every2y'} onclick={() => eRepeat = 'every2y'}>2年ごと</button>
      </div>
      <span class="sechead">積立</span>
      <div class="list sheetlist">
        <label class="row first"><span class="line"><span class="flabel">積み立てる</span><input class="check" type="checkbox" bind:checked={eReserved} /></span></label>
        {#if eReserved}
          <label class="row"><span class="line"><span class="flabel">毎月の積立</span><input inputmode="numeric" placeholder={`自動 ${yen(eAuto)}`} bind:value={eMonthly} /></span></label>
          <label class="row"><span class="line"><span class="flabel">前から貯まっていた額</span><input inputmode="numeric" placeholder="¥0" bind:value={eOpening} /></span></label>
          {#if eId}
            <label class="row"><span class="line"><span class="flabel">貯金から当てる</span><input inputmode="numeric" placeholder="¥0" bind:value={eFund} /></span></label>
            {#if savingsAccounts.length > 1}
              <label class="row"><span class="line"><span class="flabel">貯金の口座</span>
                <select bind:value={eFundAcc}>{#each savingsAccounts as a}<option value={a.id}>{a.name}</option>{/each}</select>
              </span></label>
            {/if}
          {/if}
        {/if}
      </div>
      <span class="foot pad">毎月の積立を空にすると自動（残り ÷ 払う月までの回数）に戻ります。「前から貯まっていた額」は、この仕組みを使う前に貯めていた分です。{eId && savingsAccounts.length === 0 ? '「貯金から当てる」は、今月の画面の「口座の設定」で貯金の口座を選ぶと使えます。' : ''}</span>
      {#if eId}
        <div class="list sheetlist gap">
          <button class="row action first" disabled={busy} onclick={makeNext}><span class="line">次の分を作る（{eRepeat === 'every2y' ? '2年後' : '来年'}）</span></button>
          <button class="row action del" disabled={busy} onclick={remove}><span class="line">この支払いを消す</span></button>
        </div>
      {/if}
    </div>
  </div>
{/if}
