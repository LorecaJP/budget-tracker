<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { session } from '../lib/session'
  import {
    listScheduledPayments, upsertScheduledPayment, deleteScheduledPayment, setScheduledStatus,
    listAccounts, listCategories,
  } from '../lib/db'
  import type { ScheduledPayment, Account, Category, ScheduledStatus } from '../lib/types'

  let loading = $state(true)
  let payments = $state<ScheduledPayment[]>([])     // 未払い（planned + confirmed）
  let accounts = $state<Account[]>([])
  let accMap = $state<Record<string, Account>>({})
  let categories = $state<Category[]>([])
  let catMap = $state<Record<string, Category>>({})
  let edit = $state<Partial<ScheduledPayment> | null>(null)
  let msg = $state('')

  function todayISO() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  function daysUntil(due: string): number {
    const t = new Date(todayISO() + 'T00:00:00').getTime()
    const d = new Date(due + 'T00:00:00').getTime()
    return Math.round((d - t) / 86400000)
  }
  function dueLabel(due: string): string {
    const n = daysUntil(due)
    if (n < 0) return `${-n}日超過`
    if (n === 0) return '今日'
    if (n === 1) return '明日'
    return `あと${n}日`
  }

  // 口座ごとに用意する額（未払いの合計・件数・最短引落日）
  const perAccount = $derived.by(() => {
    const m = new Map<string, { name: string; total: number; count: number; nearest: string }>()
    for (const p of payments) {
      const key = p.account_id ?? '_none'
      const name = p.account_id ? (accMap[p.account_id]?.name ?? '—') : '口座未指定'
      const cur = m.get(key) ?? { name, total: 0, count: 0, nearest: p.due_date }
      cur.total += p.amount; cur.count += 1
      if (p.due_date < cur.nearest) cur.nearest = p.due_date
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  })
  const grandTotal = $derived(payments.reduce((s, p) => s + p.amount, 0))

  async function load() {
    loading = true
    if (accounts.length === 0) {
      accounts = await listAccounts()
      accMap = Object.fromEntries(accounts.map(a => [a.id, a]))
      categories = await listCategories()
      catMap = Object.fromEntries(categories.map(c => [c.id, c]))
    }
    payments = await listScheduledPayments(false)
    loading = false
  }
  onMount(load)

  function add() {
    edit = { name: '', amount: 0, due_date: todayISO(), account_id: null, category_id: null, status: 'planned', memo: '' }
  }
  async function save() {
    if (!edit?.name || !edit.due_date) { msg = '内容と引落日を入れてください'; return }
    const payload = {
      ...edit,
      amount: Math.round(edit.amount || 0),
      user_id: $session?.user.id,
    }
    const { error } = await upsertScheduledPayment(payload)
    if (error) { msg = '保存に失敗（scheduled_payments テーブルの作成が必要かもしれません）：' + error.message; return }
    edit = null; msg = ''; load()
  }
  async function markPaid(id: string) { await setScheduledStatus(id, 'paid'); load() }
  async function remove() { if (edit?.id) await deleteScheduledPayment(edit.id); edit = null; load() }

  function statusLabel(s: ScheduledStatus) { return s === 'confirmed' ? '確定' : '予定' }
  function dd(s: string) { return parseInt(s.slice(8, 10), 10) }
  function mm(s: string) { return parseInt(s.slice(5, 7), 10) }
</script>

<div class="screen">
  <h1 class="lg-title">支払い<span class="lg-sub">引き落とし予定</span></h1>

  {#if loading}
    <p class="state">読み込み中…</p>
  {:else}
    {#if perAccount.length}
      <section class="summary">
        <div class="net-label">これから用意する合計</div>
        <div class="net neg">{yen(grandTotal)}</div>
      </section>
      <div class="sec-head">口座ごとに用意する額</div>
      <section class="card">
        {#each perAccount as a}
          <div class="pay-acct">
            <div class="tx-main">
              <span class="tx-name">{a.name}</span>
              <span class="tx-sub">最短 {mm(a.nearest)}/{dd(a.nearest)}（{dueLabel(a.nearest)}）・{a.count}件</span>
            </div>
            <span class="pa-amt">{yen(a.total)}</span>
          </div>
        {/each}
      </section>
    {/if}

    <div class="sec-head">これからの引き落とし</div>
    {#if payments.length === 0}
      <p class="state">支払い予定はありません。下の「＋」から、確定した請求（金額・引落日・口座）を登録しましょう。</p>
    {:else}
      <ul class="tx-list">
        {#each payments as p (p.id)}
          {@const over = daysUntil(p.due_date) < 0}
          <li class="tx-row tappable" onclick={() => edit = { ...p }}>
            <div class="pay-date {over ? 'over' : ''}">
              <span class="pd-d">{dd(p.due_date)}</span><span class="pd-m">{mm(p.due_date)}月</span>
            </div>
            <div class="tx-main">
              <span class="tx-name">{p.name} <span class="pay-chip {p.status}">{statusLabel(p.status)}</span></span>
              <span class="tx-sub">{p.account_id ? (accMap[p.account_id]?.name ?? '—') : '口座未指定'} · <span class={over ? 'neg' : ''}>{dueLabel(p.due_date)}</span></span>
            </div>
            <span class="tx-amt neg">{yen(p.amount)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <button class="add-inline" onclick={add}>＋ 支払い予定を追加</button>
    {#if msg}<p class="hint">{msg}</p>{/if}
    <p class="hint">請求額が確定したら金額・引落日・口座を登録。引き落とされたら行を開いて「支払済」にすると合計から外れます。</p>
  {/if}
</div>

{#if edit}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) edit = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => edit = null}>キャンセル</button><span></span><span></span></div>
      <label class="field"><span>内容</span><input type="text" bind:value={edit.name} placeholder="電気代 / 楽天カード など" /></label>
      <div class="row2">
        <label class="field"><span>金額</span><input type="number" inputmode="numeric" bind:value={edit.amount} /></label>
        <label class="field"><span>引落日</span><input type="date" bind:value={edit.due_date} /></label>
      </div>
      <label class="field"><span>引落口座</span>
        <select bind:value={edit.account_id}>
          <option value={null}>未指定</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>カテゴリ（任意）</span>
        <select bind:value={edit.category_id}>
          <option value={null}>未分類</option>
          {#each categories as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>状態</span>
        <select bind:value={edit.status}>
          <option value="planned">予定（見込み）</option>
          <option value="confirmed">確定</option>
        </select>
      </label>
      <button class="primary" onclick={save}>保存</button>
      {#if edit.id}
        <button class="add-inline" onclick={() => markPaid(edit!.id!)}>支払済にする</button>
        <button class="danger" onclick={remove}>削除</button>
      {/if}
    </div>
  </div>
{/if}
