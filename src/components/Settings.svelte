<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from '../lib/supabase'
  import { session } from '../lib/session'
  import { budgetMonthOf, budgetMonthRange, periodKey, ymd, yen, getMonthStartDay, setMonthStartDay } from '../lib/month'
  import {
    listAccounts, listCategories, upsertAccount, archiveAccount, upsertCategory, archiveCategory,
    listRecurring, upsertRecurring, deleteRecurring, postRecurringForMonth,
    listBudgets, setBudget, listTransactions, saveSettings,
    getFuyouConfig, saveFuyouConfig, type Recurring, type Budget,
  } from '../lib/db'
  import type { Account, Category, Division } from '../lib/types'
  import { DIVISION_LABELS } from '../lib/types'

  let tab = $state<'cat' | 'acc' | 'budget' | 'recurring'>('cat')
  let accounts = $state<Account[]>([])
  let categories = $state<Category[]>([])

  const DIVS: Division[] = ['income', 'tax', 'saving', 'fixed', 'variable']

  // --- 全般（月の開始日） ---
  const DAYS = Array.from({ length: 28 }, (_, i) => i + 1)
  let startDay = $state(getMonthStartDay())
  let startMsg = $state('')
  async function saveStartDay(d: number) {
    if (d === startDay) return
    const { error } = await saveSettings({ month_start_day: d }, $session!.user.id)
    if (error) { startMsg = '保存に失敗しました：' + error.message; return }
    startDay = d
    setMonthStartDay(d)
    startMsg = '保存しました。反映のため再読み込みします…'
    setTimeout(() => location.reload(), 600)
  }

  async function reload() {
    accounts = await listAccounts(true)
    categories = await listCategories(true)
    const fc = await getFuyouConfig()
    emiWage = fc.hourly_wage; emiCap = fc.year_cap
  }
  onMount(reload)

  // --- 扶養トラッカー（えみ）設定 ---
  let emiWage = $state(1180)
  let emiCap = $state(1060000)
  let emiMsg = $state('')
  async function saveEmi() {
    emiMsg = '保存中…'
    const { error } = await saveFuyouConfig({ hourly_wage: +emiWage, year_cap: +emiCap }, $session!.user.id)
    emiMsg = error ? '保存に失敗：' + error.message + '（settings に列追加が必要かもしれません）' : '保存しました'
  }

  // --- カテゴリ ---
  let catEdit = $state<Partial<Category> | null>(null)
  function newCat() { catEdit = { name: '', division: 'variable' } }
  async function saveCat() {
    if (!catEdit?.name) return
    await upsertCategory({ ...catEdit, user_id: $session?.user.id })
    catEdit = null; reload()
  }
  const catsByDiv = $derived.by(() => {
    const m: Record<string, Category[]> = {}
    for (const c of categories.filter(c => !c.archived)) (m[c.division] ??= []).push(c)
    return m
  })

  // --- 口座 ---
  let accEdit = $state<Partial<Account> | null>(null)
  function newAcc() { accEdit = { name: '', type: 'cash' } }
  async function saveAcc() {
    if (!accEdit?.name) return
    await upsertAccount({ ...accEdit, user_id: $session?.user.id })
    accEdit = null; reload()
  }

  // --- 予算 ---
  const bm = budgetMonthOf(new Date())
  const pk = periodKey(bm.year, bm.month)
  let budgets = $state<Record<string, number>>({})
  let budgetLoaded = $state(false)
  async function loadBudgets() {
    const list = await listBudgets(pk)
    budgets = Object.fromEntries(list.map(b => [b.category_id, b.amount]))
    budgetLoaded = true
  }
  async function saveBudget(catId: string, val: number) {
    await setBudget(catId, pk, Math.round(val || 0), $session!.user.id)
  }
  $effect(() => { if (tab === 'budget' && !budgetLoaded) loadBudgets() })

  // --- 定期 ---
  let recurring = $state<Recurring[]>([])
  let recLoaded = $state(false)
  let recEdit = $state<Partial<Recurring> | null>(null)
  let postMsg = $state('')
  async function loadRec() { recurring = await listRecurring(); recLoaded = true }
  $effect(() => { if (tab === 'recurring' && !recLoaded) loadRec() })
  function newRec() { recEdit = { name: '', amount: 0, type: 'expense', cycle: 'monthly', day_of_month: 25, active: true, category_id: null, account_id: null, memo: '' } }
  async function saveRec() {
    if (!recEdit?.name) return
    await upsertRecurring({ ...recEdit, user_id: $session?.user.id })
    recEdit = null; loadRec()
  }
  async function removeRec() { if (recEdit?.id) await deleteRecurring(recEdit.id); recEdit = null; loadRec() }
  async function postThisMonth() {
    postMsg = '計上中…'
    const r = budgetMonthRange(bm.year, bm.month)
    const existing = await listTransactions(ymd(r.start), ymd(r.end))
    const n = await postRecurringForMonth(bm.year, bm.month, getMonthStartDay(), existing)
    postMsg = n > 0 ? `${n}件を計上しました` : 'すでに計上済みです'
  }
</script>

<div class="screen">
  <div class="card">
    <div class="budget-row">
      <span class="tx-name">月の開始日</span>
      <select class="budget-input" value={startDay} onchange={(e) => saveStartDay(+e.currentTarget.value)}>
        {#each DAYS as d}<option value={d}>{d}日</option>{/each}
      </select>
    </div>
    <p class="hint">予算月の区切り。例：25 なら 25日〜翌24日。変更すると全画面の集計に反映されます。</p>
    {#if startMsg}<p class="hint">{startMsg}</p>{/if}
  </div>

  <div class="card">
    <div class="card-label">扶養トラッカー（えみ）</div>
    <div class="budget-row">
      <span class="tx-name">時給</span>
      <input class="budget-input" type="number" inputmode="numeric" bind:value={emiWage} />
    </div>
    <div class="budget-row">
      <span class="tx-name">年間上限</span>
      <input class="budget-input" type="number" inputmode="numeric" bind:value={emiCap} />
    </div>
    <button class="add-inline" onclick={saveEmi}>保存</button>
    <p class="hint">「扶養」タブで使う時給と年間上限（106万＝1060000 / 130万＝1300000）。{emiMsg}</p>
  </div>

  <div class="seg seg-wide">
    <button class:active={tab === 'cat'} onclick={() => tab = 'cat'}>カテゴリ</button>
    <button class:active={tab === 'acc'} onclick={() => tab = 'acc'}>口座</button>
    <button class:active={tab === 'budget'} onclick={() => tab = 'budget'}>予算</button>
    <button class:active={tab === 'recurring'} onclick={() => tab = 'recurring'}>定期</button>
  </div>

  {#if tab === 'cat'}
    {#each DIVS as d}
      <div class="day-head"><span>{DIVISION_LABELS[d]}</span></div>
      <ul class="tx-list">
        {#each (catsByDiv[d] ?? []) as c (c.id)}
          <li class="tx-row tappable" onclick={() => catEdit = { ...c }}>
            <span class="tx-name">{c.name}</span>
            <span class="link">編集</span>
          </li>
        {/each}
        {#if !(catsByDiv[d] ?? []).length}<li class="tx-row"><span class="tx-sub">なし</span></li>{/if}
      </ul>
    {/each}
    <button class="add-inline" onclick={newCat}>＋ カテゴリを追加</button>

  {:else if tab === 'acc'}
    <ul class="tx-list">
      {#each accounts.filter(a => !a.archived) as a (a.id)}
        <li class="tx-row tappable" onclick={() => accEdit = { ...a }}>
          <span class="tx-name">{a.name}</span><span class="link">編集</span>
        </li>
      {/each}
    </ul>
    <button class="add-inline" onclick={newAcc}>＋ 口座を追加</button>

  {:else if tab === 'budget'}
    <p class="hint">{bm.year}年{bm.month}月の予算（カテゴリごとに金額を入れて保存）</p>
    {#if budgetLoaded}
      {#each categories.filter(c => !c.archived && (c.division === 'fixed' || c.division === 'variable')) as c (c.id)}
        <div class="budget-row">
          <span class="tx-name">{c.name}</span>
          <input class="budget-input" type="number" inputmode="numeric" value={budgets[c.id] ?? ''} placeholder="0"
            onchange={(e) => saveBudget(c.id, +(e.currentTarget as HTMLInputElement).value)} />
        </div>
      {/each}
    {:else}<p class="state">読み込み中…</p>{/if}

  {:else if tab === 'recurring'}
    <button class="add-inline" onclick={postThisMonth}>今月分の定期を計上する</button>
    {#if postMsg}<p class="hint">{postMsg}</p>{/if}
    {#if recLoaded}
      <ul class="tx-list">
        {#each recurring as r (r.id)}
          <li class="tx-row tappable" onclick={() => recEdit = { ...r }}>
            <div class="tx-main"><span class="tx-name">{r.name}</span><span class="tx-sub">毎月{r.day_of_month}日 · {r.active ? '有効' : '停止'}</span></div>
            <span class="tx-amt neg">{yen(r.amount)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <button class="add-inline" onclick={newRec}>＋ 定期を追加</button>
  {/if}
</div>

{#if catEdit}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) catEdit = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => catEdit = null}>キャンセル</button><span></span><span></span></div>
      <label class="field"><span>名前</span><input type="text" bind:value={catEdit.name} /></label>
      <label class="field"><span>会計区分</span>
        <select bind:value={catEdit.division}>{#each DIVS as d}<option value={d}>{DIVISION_LABELS[d]}</option>{/each}</select>
      </label>
      <button class="primary" onclick={saveCat}>保存</button>
      {#if catEdit.id}<button class="danger" onclick={async () => { await archiveCategory(catEdit!.id!, true); catEdit = null; reload() }}>非表示にする</button>{/if}
    </div>
  </div>
{/if}

{#if accEdit}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) accEdit = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => accEdit = null}>キャンセル</button><span></span><span></span></div>
      <label class="field"><span>名前</span><input type="text" bind:value={accEdit.name} /></label>
      <label class="field"><span>種類</span>
        <select bind:value={accEdit.type}>
          <option value="cash">現金</option><option value="bank">銀行</option>
          <option value="credit">クレジットカード</option><option value="emoney">電子マネー</option>
        </select>
      </label>
      <button class="primary" onclick={saveAcc}>保存</button>
      {#if accEdit.id}<button class="danger" onclick={async () => { await archiveAccount(accEdit!.id!, true); accEdit = null; reload() }}>非表示にする</button>{/if}
    </div>
  </div>
{/if}

{#if recEdit}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) recEdit = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => recEdit = null}>キャンセル</button><span></span><span></span></div>
      <label class="field"><span>名前</span><input type="text" bind:value={recEdit.name} placeholder="家賃 など" /></label>
      <div class="row2">
        <label class="field"><span>金額</span><input type="number" inputmode="numeric" bind:value={recEdit.amount} /></label>
        <label class="field"><span>毎月の日</span><input type="number" inputmode="numeric" bind:value={recEdit.day_of_month} /></label>
      </div>
      <label class="field"><span>カテゴリ</span>
        <select bind:value={recEdit.category_id}>
          <option value={null}>未分類</option>
          {#each categories.filter(c => !c.archived) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>口座</span>
        <select bind:value={recEdit.account_id}>
          <option value={null}>未指定</option>
          {#each accounts.filter(a => !a.archived) as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="check"><input type="checkbox" bind:checked={recEdit.active} /> 有効</label>
      <button class="primary" onclick={saveRec}>保存</button>
      {#if recEdit.id}<button class="danger" onclick={removeRec}>削除</button>{/if}
    </div>
  </div>
{/if}
