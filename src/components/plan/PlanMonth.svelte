<script lang="ts">
  // 作り替え§12 ②「今月」：その月の使えるお金を、毎月の支出と大きな支払いの積立に割り当てる画面。
  // 計算は src/lib/plan/allocation.ts（純粋関数）。保存は db.ts（plan_lines / fund_uses / scheduled_payments / accounts）。
  // 試作：https://claude.ai/artifact/1AivyZHk9cHB2x47SAa9me
  import { onMount } from 'svelte'
  import './plan.css'
  import { portal } from '../../lib/portal'
  import { session } from '../../lib/session'
  import { getMonthStartDay } from '../../lib/month'
  import {
    loadPlanInput, savePlanLine, saveFundUse, deleteFundUse, listFundUses,
    upsertScheduledPayment, deleteScheduledPayment, listAccounts, setAccountRole, listCategories,
  } from '../../lib/db'
  import {
    computeMonths, carryStartKey, periodOfDate, shiftKey, keyDiff, parseKey,
    type PlanInput, type MonthResult, type PaymentRow, type BigRow, type RowStatus, type AccountRole, type FundUse,
  } from '../../lib/plan/allocation'
  import type { Account, Category } from '../../lib/types'

  const startDay = getMonthStartDay()
  const WD = ['日', '月', '火', '水', '木', '金', '土']
  function todayISO() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const today = todayISO()
  const currentKey = periodOfDate(today, startDay)

  let inp = $state<PlanInput | null>(null)
  let accounts = $state<Account[]>([])
  let categories = $state<Category[]>([])
  let funds = $state<FundUse[]>([])
  let key = $state(currentKey)
  let loading = $state(true)
  let toast = $state('')
  let busy = $state(false)

  async function reload() {
    const [p, a, f, c] = await Promise.all([loadPlanInput(startDay, today), listAccounts(), listFundUses(), listCategories()])
    inp = p; accounts = a; funds = f; categories = c
    loading = false
  }
  onMount(reload)

  function flash(t: string) { toast = t; setTimeout(() => { if (toast === t) toast = '' }, 2200) }
  const yen = (n: number) => (n < 0 ? '−¥' : '¥') + Math.abs(Math.round(n)).toLocaleString('ja-JP')
  const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
  const wd = (iso: string) => WD[new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).getDay()]
  const jp = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日（${wd(iso)}）`
  const accName = (id: string | null) => (id && accounts.find(a => a.id === id)?.name) || '口座が未設定'

  // 計算する範囲：一番古いデータの年の1月〜1年先の年の12月（年ごとの画面で年全体を見るため）。
  // 繰り越しは割り当てを始めた月から（carryStartKey）。
  const firstKey = $derived.by(() => {
    if (!inp) return currentKey
    const keys = [
      ...inp.incomeActuals.map(x => x.period_month),
      ...inp.lines.map(x => x.period_month),
      ...inp.funds.map(x => x.period_month),
      ...(inp.cardTotals ?? []).map(x => x.month),
      currentKey,
    ]
    return keys.reduce((a, b) => (keyDiff(a, b) < 0 ? b : a))
  })
  const firstYear = $derived(Math.min(parseKey(firstKey).y, parseKey(key).y))
  const lastYear = $derived(Math.max(parseKey(shiftKey(currentKey, 12)).y, parseKey(key).y))
  const months = $derived.by<MonthResult[]>(() => {
    if (!inp) return []
    return computeMonths(inp, `${firstYear}-01`, `${lastYear}-12`, carryStartKey(inp, currentKey))
  })
  const m = $derived(months.find(x => x.key === key) ?? null)
  const label = $derived(`${parseKey(key).m}月${startDay}日の給料`)
  const badge = $derived(key === currentKey ? '今回' : key === shiftKey(currentKey, 1) ? '次回' : keyDiff(key, currentKey) > 0 ? '過去' : '先の月')

  // 状態の文字と色
  function stat(s: RowStatus, need: number, alloc: number | null, actual: number | null): { t: string; c: string } {
    switch (s) {
      case 'unallocated': return { t: '未割り当て', c: 'sec' }
      case 'ready': return { t: '用意済み', c: 'ok' }
      case 'short': return { t: `あと ${yen(need - (alloc ?? 0))}`, c: 'warn' }
      case 'paid': return { t: '支払い済み', c: 'sec' }
      case 'over': return { t: `${yen((actual ?? 0) - (alloc ?? 0))} 不足`, c: 'bad' }
      case 'under': return { t: `${yen((alloc ?? 0) - (actual ?? 0))} 余り`, c: 'tint' }
    }
  }

  // ---------- 行の編集（予定・実際・割り当て） ----------
  type Edit = { kind: 'payment'; row: PaymentRow } | { kind: 'big'; row: BigRow }
  let edit = $state<Edit | null>(null)
  let dPlan = $state(''), dAct = $state(''), dAlloc = $state('')
  const num = (v: string) => { const d = String(v ?? '').replace(/[^0-9]/g, ''); return d === '' ? null : Number(d) }
  function openPayment(row: PaymentRow) {
    edit = { kind: 'payment', row }
    dPlan = String(row.planned); dAct = row.actualFrom === 'manual' && row.actual != null ? String(row.actual) : ''; dAlloc = row.allocated != null ? String(row.allocated) : ''
  }
  function openBig(row: BigRow) {
    edit = { kind: 'big', row }
    dPlan = ''; dAct = ''; dAlloc = row.allocated != null ? String(row.allocated) : ''
  }
  const editNeed = $derived.by(() => {
    if (!edit) return 0
    if (edit.kind === 'big') return edit.row.need
    return num(dAct) ?? (edit.row.actualFrom === 'card' ? edit.row.actual : null) ?? num(dPlan) ?? edit.row.planned
  })
  async function saveEdit() {
    if (!edit || !m) return
    busy = true
    const res = edit.kind === 'payment'
      ? await savePlanLine({
          period_month: m.key, kind: 'payment', payment_id: edit.row.rule.id, special_id: null,
          planned: num(dPlan) == null || num(dPlan) === edit.row.rule.amount ? null : num(dPlan),
          actual: num(dAct), allocated: num(dAlloc),
        })
      : await savePlanLine({
          period_month: m.key, kind: 'big', payment_id: null, special_id: edit.row.big.id,
          planned: null, actual: null, allocated: num(dAlloc),
        })
    busy = false
    if (res && 'error' in res && res.error) { flash('保存できませんでした：' + res.error.message); return }
    edit = null
    await reload()
    flash('保存しました')
  }

  // ---------- 残りを一度に割り当てる ----------
  async function bulk() {
    if (!m) return
    busy = true
    const jobs = [
      ...m.payments.filter(p => p.allocated == null).map(p => savePlanLine({
        period_month: m.key, kind: 'payment', payment_id: p.rule.id, special_id: null,
        planned: p.planned === p.rule.amount ? null : p.planned, actual: p.actual, allocated: p.need,
      })),
      ...m.bigs.filter(b => b.allocated == null).map(b => savePlanLine({
        period_month: m.key, kind: 'big', payment_id: null, special_id: b.big.id, planned: null, actual: null, allocated: b.need,
      })),
    ]
    const n = jobs.length
    await Promise.all(jobs)
    busy = false
    await reload()
    flash(`${n}件を割り当てました`)
  }

  // ---------- 貯金から使う ----------
  const savingsAccounts = $derived(accounts.filter(a => !a.archived && a.role === 'savings'))
  let fundOpen = $state(false)
  let dFund = $state(''), dFundAcc = $state<string | null>(null)
  const fundRow = $derived(funds.find(f => f.period_month === key && !f.special_id) ?? null)
  function openFund() {
    fundOpen = true
    dFund = fundRow ? String(fundRow.amount) : ''
    dFundAcc = fundRow?.account_id ?? savingsAccounts[0]?.id ?? null
  }
  async function saveFund() {
    const v = num(dFund) ?? 0
    busy = true
    if (fundRow?.id && v === 0) await deleteFundUse(fundRow.id)
    else if (v > 0) await saveFundUse({ id: fundRow?.id, period_month: key, account_id: dFundAcc, special_id: null, amount: v })
    busy = false
    fundOpen = false
    await reload()
    flash(v ? `${yen(v)} を使えるお金に足しました` : '貯金から使う額を外しました')
  }

  // ---------- 毎月の項目（決まり）の追加・編集 ----------
  let ruleOpen = $state(false)
  let rId = $state<string | null>(null), rName = $state(''), rDir = $state<'out' | 'in'>('out'), rAmt = $state(''), rDay = $state(''), rAcc = $state<string | null>(null), rCat = $state<string | null>(null), rCard = $state(false), rCardWas = $state(false)
  function openRule(row?: PaymentRow) {
    ruleOpen = true
    rId = row?.rule.id ?? null; rName = row?.rule.name ?? ''; rDir = row?.rule.direction ?? 'out'
    rAmt = row ? String(row.rule.amount) : ''; rDay = row?.rule.due_day ? String(row.rule.due_day) : ''; rAcc = row?.rule.account_id ?? null; rCat = row?.rule.category_id ?? null
    rCard = row?.rule.card_source === 'rakuten'; rCardWas = rCard
  }
  async function saveRule() {
    if (!rName.trim()) { flash('名前を入れてください'); return }
    const day = num(rDay)
    if (day != null && (day < 1 || day > 31)) { flash('日は1〜31で入れてください'); return }
    busy = true
    const res = await upsertScheduledPayment({
      id: rId ?? undefined, user_id: rId ? undefined : $session?.user.id,
      name: rName.trim(), direction: rDir, amount: num(rAmt) ?? 0, due_day: day, due_date: null,
      account_id: rAcc, category_id: rCat, status: 'planned', active: true,
      // card_source 列は plan.sql の 10) を実行してから使える。印を付けない（付けていなかった）ときは送らない＝列が無くても保存できる
      ...(rCard || rCardWas ? { card_source: rCard && rDir === 'out' ? 'rakuten' as const : null } : {}),
    })
    busy = false
    if (res.error) { flash('保存できませんでした：' + res.error.message); return }
    ruleOpen = false
    await reload()
    flash('保存しました')
  }
  async function removeRule() {
    if (!rId || !confirm(`「${rName}」を消しますか？（これまでの月の割り当ても消えます）`)) return
    busy = true
    await deleteScheduledPayment(rId)
    busy = false
    ruleOpen = false
    await reload()
    flash('消しました')
  }

  // ---------- 口座の役割 ----------
  let accOpen = $state(false)
  async function setRole(a: Account, role: AccountRole) {
    await setAccountRole(a.id, role)
    await reload()
  }
  const ROLE_LABEL: Record<AccountRole, string> = { normal: 'ふつう', salary: '給料の受け取り', savings: '割り当てに使う貯金' }

  const ratio = $derived(m && m.sources > 0 ? Math.max(0, Math.min(100, Math.round(m.allocSum / m.sources * 100))) : 0)
  const hasSalary = $derived(accounts.some(a => a.role === 'salary'))

  // ---------- 年ごとの画面（作り替え⑤） ----------
  let view = $state<'month' | 'year'>('month')
  let yr = $state(parseKey(currentKey).y)
  // 過去の月で、明細・割り当て・実際の額の記録が1つも無い月は「記録なし」（決まりの額だけで数えると実際と違うため年の合計にも入れない）
  function hasRecord(x: MonthResult): boolean {
    return x.incomes.some(i => i.actual != null) || x.payments.some(p => p.actual != null || p.allocated != null)
      || x.bigs.some(b => b.allocated != null) || x.fundIn > 0
  }
  const yearData = $derived.by(() => {
    const rows = months.filter(x => parseKey(x.key).y === yr).map(x => {
      const past = keyDiff(x.key, currentKey) > 0
      const empty = past && !hasRecord(x)
      return { m: x, past, empty, income: x.incomeSum, out: x.needSum, diff: x.incomeSum - x.needSum }
    })
    const counted = rows.filter(r => !r.empty)
    const income = counted.reduce((a, r) => a + r.income, 0), out = counted.reduce((a, r) => a + r.out, 0)
    return { rows, income, out, diff: income - out }
  })
  const years = $derived(Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i))
  function openYear() { yr = parseKey(key).y; view = 'year' }
  function openMonth(k: string) { key = k; view = 'month' }
</script>

<div class="pm">
  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if view === 'year'}
    <div class="titlebar"><h1>{yr}年</h1></div>
    <div class="segy" style="grid-template-columns: repeat({years.length}, minmax(0, 1fr))">
      {#each years as y}<button class:on={y === yr} onclick={() => yr = y}>{y}年</button>{/each}
    </div>
    <div class="hero">
      <span class="cap">1年の差し引き</span>
      <span class="big" class:minus={yearData.diff < 0}>{yearData.diff >= 0 ? '+' : ''}{yen(yearData.diff)}</span>
      <div class="stats two">
        <div><span class="cap">入ったお金・入る予定</span><span class="v">{yen(yearData.income)}</span></div>
        <div><span class="cap">出たお金・出る予定</span><span class="v">{yen(yearData.out)}</span></div>
      </div>
    </div>
    <span class="sechead">月ごと（給料日で区切った月）</span>
    <div class="list">
      {#each yearData.rows as r, i}
        <button class="row" class:first={i === 0} onclick={() => openMonth(r.m.key)}>
          <span class="line">
            <span class="ymon">{parseKey(r.m.key).m}月</span>
            <span class="main">
              <span class="sub2">{md(r.m.range.start)}〜{md(r.m.range.end)}{r.m.key === currentKey ? '・今回' : ''}</span>
              <span class="sub2">{r.empty ? '記録なし' : `入 ${yen(r.income)}・出 ${yen(r.out)}${r.past ? '' : '（予定を含む）'}`}</span>
            </span>
            <span class="amt" class:minusc={!r.empty && r.diff < 0} class:mutedc={r.empty}>{r.empty ? '—' : `${r.diff >= 0 ? '+' : ''}${yen(r.diff)}`}</span>
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="#C4C4C7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>
          </span>
        </button>
      {/each}
    </div>
    <span class="foot pad">出たお金は、実際の額が分かる項目は実際の額、それ以外は予定の額で数えています。明細も割り当ても無い過去の月は「記録なし」で、合計に入れていません。月をタップすると中身が見られます。</span>
  {:else if m}
    <button class="backbtn" onclick={openYear}>
      <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2L2 10l8 8"/></svg>{parseKey(key).y}年
    </button>
    <div class="titlebar">
      <h1>今月</h1>
      <span class="sub">{badge}</span>
    </div>

    <div class="monthnav">
      <button class="chev" aria-label="前の月" onclick={() => key = shiftKey(key, -1)}>
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2L2 10l8 8"/></svg>
      </button>
      <div class="mtitle">
        <span class="mlabel">{label}</span>
        <span class="mrange">{md(m.range.start)}〜{md(m.range.end)}</span>
      </div>
      <button class="chev" aria-label="次の月" onclick={() => key = shiftKey(key, 1)}>
        <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l8 8-8 8"/></svg>
      </button>
    </div>

    <div class="hero">
      <span class="cap">まだ割り当てていないお金</span>
      <span class="big" class:minus={m.free < 0}>{yen(m.free)}</span>
      <div class="pbar"><span style="width: {ratio}%"></span></div>
      <div class="stats">
        <div><span class="cap">使えるお金</span><span class="v">{yen(m.sources)}</span></div>
        <div><span class="cap">割り当て済み</span><span class="v">{yen(m.allocSum)}</span></div>
        <div><span class="cap">必要な額</span><span class="v">{yen(m.needSum)}</span></div>
      </div>
    </div>

    {#if m.restCount > 0}
      <div class="block">
        <button class="filled" disabled={busy} onclick={bulk}>残り{m.restCount}件を割り当てる</button>
        <span class="foot">割り当てると、残るお金は {yen(m.free - m.rest)} です。</span>
      </div>
    {/if}
    {#if m.diffCount > 0}
      <div class="notice">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17H2.5L12 3z"/><path d="M12 10v4M12 17.5v.01"/></svg>
        <span>予定と実際の額が違う項目が{m.diffCount}件（{m.diffSum >= 0 ? `${yen(m.diffSum)} 不足` : `${yen(-m.diffSum)} 余り`}）。タップして割り当てを合わせてください。</span>
      </div>
    {/if}

    <span class="sechead">使えるお金</span>
    <div class="list">
      {#each m.incomes as x, i}
        <div class="row" class:first={i === 0}>
          <span class="line">
            <span class="main"><span class="name">{x.name}</span><span class="sub2">{x.date ? jp(x.date) : '給与明細から'}</span></span>
            <span class="right"><span class="amt">{yen(x.amount)}</span><span class="st {x.actual != null ? 'ok' : 'sec'}">{x.actual != null ? '確定' : '予定'}</span></span>
          </span>
        </div>
      {/each}
      <div class="row" class:first={m.incomes.length === 0}>
        <span class="line">
          <span class="main"><span class="name">繰り越し</span><span class="sub2">{m.carryIn === 0 && keyDiff(key, carryStartKey(inp!, currentKey)) >= 0 ? '割り当てを始めた月から数えます' : '前の月で割り当てなかった分'}</span></span>
          <span class="right"><span class="amt">{yen(m.carryIn)}</span><span class="st sec">自動</span></span>
        </span>
      </div>
      {#if m.fundIn}
        <button class="row" onclick={openFund}>
          <span class="line">
            <span class="main"><span class="name">貯金から</span><span class="sub2">{accName(fundRow?.account_id ?? null)}</span></span>
            <span class="right"><span class="amt">{yen(m.fundIn)}</span><span class="st tint">手で入力</span></span>
          </span>
        </button>
      {/if}
      <button class="row action" onclick={openFund}><span class="line">貯金から使う</span></button>
    </div>
    {#if m.incomes.length === 0}
      <span class="foot pad">この月の給与明細がまだありません。給料の予定は「毎月の項目を追加」で収入として入れられます。</span>
    {/if}

    <span class="sechead">毎月の支出</span>
    <div class="list">
      {#each m.payments as p, i}
        {@const s = stat(p.status, p.need, p.allocated, p.actual)}
        <button class="row" class:first={i === 0} onclick={() => openPayment(p)}>
          <span class="line">
            <span class="date">{#if p.date}<b>{md(p.date)}</b><small>{wd(p.date)}曜</small>{:else}<b>予算</b>{/if}</span>
            <span class="main"><span class="name">{p.rule.name}</span><span class="sub2">{accName(p.rule.account_id)}{p.moved ? '・休日のためずらす' : ''}{p.actualFrom === 'card' ? '・明細から' : ''}</span></span>
            <span class="right"><span class="amt">{yen(p.need)}</span><span class="st {s.c}">{s.t}</span></span>
          </span>
        </button>
      {/each}
      <button class="row action" class:first={m.payments.length === 0} onclick={() => openRule()}><span class="line">毎月の項目を追加</span></button>
    </div>
    <span class="foot pad">{startDay}日の給料で、{startDay}日〜翌{startDay - 1}日の支払いを払います。項目の名前・金額・日・口座は、項目を開いて「決まりを直す」から。</span>

    <span class="sechead">大きな支払いの積立</span>
    <div class="list">
      {#each m.bigs as b, i}
        {@const s = stat(b.status, b.need, b.allocated, null)}
        <button class="row" class:first={i === 0} onclick={() => openBig(b)}>
          <span class="line">
            <span class="main"><span class="name">{b.big.name}</span><span class="sub2">{b.big.planned_month}月{b.big.due_day ? b.big.due_day + '日' : ''}に払う・{b.remainingTimes > 1 ? `残り${b.remainingTimes}回` : '最後の積立'}</span></span>
            <span class="right"><span class="amt">{yen(b.need)}</span><span class="st {s.c}">{s.t}</span></span>
          </span>
        </button>
      {:else}
        <div class="row first"><span class="line muted">なし</span></div>
      {/each}
    </div>

    {#if m.payBigs.length}
      <span class="sechead">この月に払う大きな支払い</span>
      <div class="list">
        {#each m.payBigs as b, i}
          <div class="row" class:first={i === 0}>
            <span class="line">
              <span class="date"><b>{b.big.planned_month}月</b><small>{b.big.due_day ? b.big.due_day + '日' : '日未定'}</small></span>
              <span class="main"><span class="name">{b.big.name}</span><span class="sub2">積立（予定を含む） {yen(b.projected)}</span></span>
              <span class="right"><span class="amt">{yen(b.big.budget_amount)}</span><span class="st {b.enough ? 'ok' : 'bad'}">{b.enough ? '用意できる見込み' : `${yen(b.big.budget_amount - b.projected)} 不足の見込み`}</span></span>
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <span class="sechead">給料が入ったら移す額</span>
    <div class="list">
      {#each m.moves as mv, i}
        <div class="row" class:first={i === 0}>
          <span class="line">
            <span class="main"><span class="name">→ {accName(mv.accountId)}</span><span class="sub2">{mv.names.join('、')}</span></span>
            <span class="right"><span class="amt">{yen(mv.amount)}</span></span>
          </span>
        </div>
      {:else}
        <div class="row first"><span class="line muted">{hasSalary ? '割り当てると表示されます' : '口座の設定で「給料の受け取り」を選ぶと表示されます'}</span></div>
      {/each}
      <button class="row action" onclick={() => accOpen = true}><span class="line">口座の設定</span></button>
    </div>
  {/if}
</div>

{#if toast}<div class="pm-toast" use:portal>{toast}</div>{/if}

{#if edit && m}
  <div class="pm-back" use:portal onclick={(e) => { if (e.target === e.currentTarget) edit = null }} role="presentation">
    <div class="pm-sheet">
      <div class="grab"></div>
      <div class="nav">
        <button class="navbtn" onclick={() => edit = null}>キャンセル</button>
        <span class="navtitle">{edit.kind === 'payment' ? edit.row.rule.name : edit.row.big.name}</span>
        <button class="navbtn strong" disabled={busy} onclick={saveEdit}>保存</button>
      </div>
      <span class="sheetinfo">
        {#if edit.kind === 'payment'}{edit.row.date ? jp(edit.row.date) : '月の予算'}・{accName(edit.row.rule.account_id)}{:else}{edit.row.big.year}年{edit.row.big.planned_month}月に払う・{yen(edit.row.big.budget_amount)}{/if}
      </span>
      {#if edit.kind === 'payment'}
        <div class="list sheetlist">
          <label class="row first"><span class="line"><span class="flabel">予定の額</span><input inputmode="numeric" bind:value={dPlan} /></span></label>
          <label class="row"><span class="line"><span class="flabel">実際の額</span><input inputmode="numeric" placeholder={edit.row.actualFrom === 'card' && edit.row.actual != null ? `明細 ${yen(edit.row.actual)}` : '未定'} bind:value={dAct} /></span></label>
        </div>
      {/if}
      <span class="sechead">{label}から</span>
      <div class="list sheetlist">
        <label class="row first"><span class="line"><span class="flabel">割り当てる額</span><input class="strong" inputmode="numeric" placeholder="未割り当て" bind:value={dAlloc} /></span></label>
        <button class="row action" onclick={() => dAlloc = String(editNeed)}><span class="line">必要な額に合わせる</span></button>
        <button class="row action del" onclick={() => dAlloc = ''}><span class="line">割り当てを外す</span></button>
      </div>
      <span class="foot pad {num(dAlloc) == null ? '' : (num(dAlloc) ?? 0) >= editNeed ? 'ok' : 'warn'}">
        {#if num(dAlloc) == null}必要な額は {yen(editNeed)}。まだ割り当てていません。{:else if (num(dAlloc) ?? 0) >= editNeed}必要な額 {yen(editNeed)} を用意できています。{:else}必要な額 {yen(editNeed)} まで、あと {yen(editNeed - (num(dAlloc) ?? 0))}。{/if}
      </span>
      {#if edit.kind === 'payment'}
        <div class="list sheetlist gap">
          <button class="row action first" onclick={() => { const r = edit?.kind === 'payment' ? edit.row : undefined; edit = null; openRule(r) }}><span class="line">決まりを直す（名前・ふだんの額・日・口座）</span></button>
        </div>
      {:else}
        <span class="foot pad">毎月の積立額は、残りの額を払う月までの回数で割って自動で出しています。</span>
      {/if}
    </div>
  </div>
{/if}

{#if fundOpen}
  <div class="pm-back" use:portal onclick={(e) => { if (e.target === e.currentTarget) fundOpen = false }} role="presentation">
    <div class="pm-sheet">
      <div class="grab"></div>
      <div class="nav">
        <button class="navbtn" onclick={() => fundOpen = false}>キャンセル</button>
        <span class="navtitle">貯金から使う</span>
        <button class="navbtn strong" disabled={busy || !dFundAcc} onclick={saveFund}>保存</button>
      </div>
      {#if savingsAccounts.length === 0}
        <span class="foot pad">割り当てに使う貯金の口座がまだありません。「口座の設定」で、貯金の口座を「割り当てに使う貯金」にしてください。</span>
      {:else}
        <div class="list sheetlist">
          <label class="row first"><span class="line"><span class="flabel">口座</span>
            <select bind:value={dFundAcc}>{#each savingsAccounts as a}<option value={a.id}>{a.name}</option>{/each}</select>
          </span></label>
          <label class="row"><span class="line"><span class="flabel">{label}に使う額</span><input class="strong" inputmode="numeric" placeholder="¥0" bind:value={dFund} /></span></label>
        </div>
        <span class="foot pad">「使えるお金」に足されます。0 にすると外れます。給料を受け取る口座は、給料と二重に数えないため選べません。</span>
      {/if}
    </div>
  </div>
{/if}

{#if ruleOpen}
  <div class="pm-back" use:portal onclick={(e) => { if (e.target === e.currentTarget) ruleOpen = false }} role="presentation">
    <div class="pm-sheet">
      <div class="grab"></div>
      <div class="nav">
        <button class="navbtn" onclick={() => ruleOpen = false}>キャンセル</button>
        <span class="navtitle">{rId ? '毎月の項目' : '毎月の項目を追加'}</span>
        <button class="navbtn strong" disabled={busy} onclick={saveRule}>保存</button>
      </div>
      <div class="seg2">
        <button class:on={rDir === 'out'} onclick={() => rDir = 'out'}>支出</button>
        <button class:on={rDir === 'in'} onclick={() => rDir = 'in'}>収入</button>
      </div>
      <div class="list sheetlist">
        <label class="row first"><span class="line"><span class="flabel">名前</span><input class="text" placeholder="例：家賃、食費、ゆうき給料" bind:value={rName} /></span></label>
        <label class="row"><span class="line"><span class="flabel">ふだんの額</span><input inputmode="numeric" placeholder="¥0" bind:value={rAmt} /></span></label>
        <label class="row"><span class="line"><span class="flabel">毎月の日</span><input inputmode="numeric" placeholder="なし（予算だけ）" bind:value={rDay} /></span></label>
        <label class="row"><span class="line"><span class="flabel">口座</span>
          <select bind:value={rAcc}><option value={null}>未設定</option>{#each accounts.filter(a => !a.archived) as a}<option value={a.id}>{a.name}</option>{/each}</select>
        </span></label>
        <label class="row"><span class="line"><span class="flabel">カテゴリ</span>
          <select bind:value={rCat}><option value={null}>なし</option>{#each categories.filter(c => !c.archived && (rDir === 'in' ? c.division === 'income' : c.division !== 'income')) as c}<option value={c.id}>{c.name}</option>{/each}</select>
        </span></label>
        {#if rDir === 'out'}
          <label class="row"><span class="line"><span class="flabel">楽天カードの明細から</span><input class="check" type="checkbox" bind:checked={rCard} /></span></label>
        {/if}
      </div>
      <span class="foot pad">日を空にすると、食費のような「月の予算だけ」の項目になります。「楽天カードの明細から」に印を付けると、楽天カードの明細を取り込んだとき、その月に引き落とされる請求の合計が「実際の額」に入ります（割り当ては変えません）。月末なら 31 と入れてください。収入の項目は、カテゴリ（ゆうき給料など）を選ぶと、給与明細を取り込んだときにその手取りに置き換わります（選ばないと明細と二重に数えます）。</span>
      {#if rId}
        <div class="list sheetlist gap"><button class="row action del first" onclick={removeRule}><span class="line">この項目を消す</span></button></div>
      {/if}
    </div>
  </div>
{/if}

{#if accOpen}
  <div class="pm-back" use:portal onclick={(e) => { if (e.target === e.currentTarget) accOpen = false }} role="presentation">
    <div class="pm-sheet">
      <div class="grab"></div>
      <div class="nav">
        <span></span>
        <span class="navtitle">口座の設定</span>
        <button class="navbtn strong" onclick={() => accOpen = false}>完了</button>
      </div>
      <div class="list sheetlist">
        {#each accounts.filter(a => !a.archived) as a, i}
          <label class="row" class:first={i === 0}><span class="line"><span class="flabel">{a.name}</span>
            <select value={a.role ?? 'normal'} onchange={(e) => setRole(a, (e.currentTarget as HTMLSelectElement).value as AccountRole)}>
              {#each Object.entries(ROLE_LABEL) as [v, t]}<option value={v}>{t}</option>{/each}
            </select>
          </span></label>
        {/each}
      </div>
      <span class="foot pad">「給料の受け取り」の口座から、ほかの口座へ移す額を出します。「割り当てに使う貯金」の口座は「貯金から使う」で選べます。</span>
    </div>
  </div>
{/if}
