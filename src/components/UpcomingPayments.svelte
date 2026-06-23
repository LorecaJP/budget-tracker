<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { nextMonthlyDue } from '../lib/businessday'
  import { session } from '../lib/session'
  import {
    listScheduledPayments, upsertScheduledPayment, deleteScheduledPayment, setScheduledStatus,
    listAccounts, listCategories,
  } from '../lib/db'
  import type { ScheduledPayment, Account, Category, ScheduledStatus } from '../lib/types'

  let loading = $state(true)
  let raw = $state<ScheduledPayment[]>([])
  let accounts = $state<Account[]>([])
  let accMap = $state<Record<string, Account>>({})
  let categories = $state<Category[]>([])
  let edit = $state<Partial<ScheduledPayment> | null>(null)
  let repeatMonthly = $state(true)
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
  // 表示上の引落日（毎月くりかえしは次回を休日補正で算出、単発は due_date）
  function effDate(p: { due_day: number | null; due_date: string | null }): string {
    return p.due_day != null ? nextMonthlyDue(p.due_day) : (p.due_date ?? todayISO())
  }
  const isRecurring = (p: { due_day: number | null }) => p.due_day != null

  // 表示対象：毎月くりかえしは常に表示／単発は未払いのみ。引落日順。
  const items = $derived(
    raw
      .filter(p => isRecurring(p) || p.status !== 'paid')
      .map(p => ({ p, eff: effDate(p) }))
      .sort((a, b) => a.eff < b.eff ? -1 : a.eff > b.eff ? 1 : 0)
  )

  // 口座ごとに用意する額（合計・件数・最短引落日）
  const perAccount = $derived.by(() => {
    const m = new Map<string, { name: string; total: number; count: number; nearest: string }>()
    for (const { p, eff } of items) {
      const key = p.account_id ?? '_none'
      const name = p.account_id ? (accMap[p.account_id]?.name ?? '—') : '口座未指定'
      const cur = m.get(key) ?? { name, total: 0, count: 0, nearest: eff }
      cur.total += p.amount; cur.count += 1
      if (eff < cur.nearest) cur.nearest = eff
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  })
  const grandTotal = $derived(items.reduce((s, x) => s + x.p.amount, 0))

  async function load() {
    loading = true
    if (accounts.length === 0) {
      accounts = await listAccounts()
      accMap = Object.fromEntries(accounts.map(a => [a.id, a]))
      categories = await listCategories()
    }
    raw = await listScheduledPayments(true)
    loading = false
  }
  onMount(load)

  function add() {
    repeatMonthly = true
    edit = { name: '', amount: 0, due_day: new Date().getDate(), due_date: null, account_id: null, category_id: null, status: 'confirmed', memo: '' }
  }
  function openEdit(p: ScheduledPayment) {
    repeatMonthly = isRecurring(p)
    edit = { ...p }
  }
  async function save() {
    if (!edit?.name) { msg = '内容を入れてください'; return }
    const payload: Partial<ScheduledPayment> & { user_id?: string } = {
      ...edit,
      amount: Math.round(edit.amount || 0),
      user_id: $session?.user.id,
    }
    if (repeatMonthly) {
      const d = Math.min(28, Math.max(1, Math.round(edit.due_day || 1)))
      payload.due_day = d; payload.due_date = null
    } else {
      if (!edit.due_date) { msg = '引落日を入れてください'; return }
      payload.due_day = null
    }
    const { error } = await upsertScheduledPayment(payload)
    if (error) { msg = '保存に失敗（scheduled_payments の作成／更新が必要かもしれません）：' + error.message; return }
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
    {#if items.length === 0}
      <p class="state">支払い予定はありません。下の「＋」から、引落日・金額・口座を登録しましょう（毎月くりかえしも選べます）。</p>
    {:else}
      <ul class="tx-list">
        {#each items as { p, eff } (p.id)}
          {@const over = daysUntil(eff) < 0}
          <li class="tx-row tappable" onclick={() => openEdit(p)}>
            <div class="pay-date {over ? 'over' : ''}">
              <span class="pd-d">{dd(eff)}</span><span class="pd-m">{mm(eff)}月</span>
            </div>
            <div class="tx-main">
              <span class="tx-name">{p.name} <span class="pay-chip {isRecurring(p) ? 'rec' : p.status}">{isRecurring(p) ? '毎月' : statusLabel(p.status)}</span></span>
              <span class="tx-sub">{p.account_id ? (accMap[p.account_id]?.name ?? '—') : '口座未指定'} · <span class={over ? 'neg' : ''}>{dueLabel(eff)}</span></span>
            </div>
            <span class="tx-amt neg">{yen(p.amount)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <button class="add-inline" onclick={add}>＋ 支払い予定を追加</button>
    {#if msg}<p class="hint">{msg}</p>{/if}
    <p class="hint">毎月くりかえしは引落日が土日祝なら翌営業日で表示。請求額が変わるもの（電気・水道・携帯など）は確定したら金額を直してください。引き落とされた単発分は行を開いて「支払済」に。</p>
  {/if}
</div>

{#if edit}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) edit = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => edit = null}>キャンセル</button><span></span><span></span></div>
      <label class="field"><span>内容</span><input type="text" bind:value={edit.name} placeholder="家賃 / 電気代 / 楽天カード など" /></label>
      <label class="field"><span>金額（予定額）</span><input type="number" inputmode="numeric" bind:value={edit.amount} /></label>
      <div class="seg seg-wide">
        <button class:active={repeatMonthly} onclick={() => repeatMonthly = true}>毎月くりかえし</button>
        <button class:active={!repeatMonthly} onclick={() => repeatMonthly = false}>1回だけ</button>
      </div>
      {#if repeatMonthly}
        <label class="field"><span>引落日（毎月／1〜28）</span><input type="number" inputmode="numeric" min="1" max="28" bind:value={edit.due_day} /></label>
      {:else}
        <label class="field"><span>引落日</span><input type="date" bind:value={edit.due_date} /></label>
      {/if}
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
      {#if !repeatMonthly}
        <label class="field"><span>状態</span>
          <select bind:value={edit.status}>
            <option value="planned">予定（見込み）</option>
            <option value="confirmed">確定</option>
          </select>
        </label>
      {/if}
      <button class="primary" onclick={save}>保存</button>
      {#if edit.id}
        {#if !repeatMonthly}<button class="add-inline" onclick={() => markPaid(edit!.id!)}>支払済にする</button>{/if}
        <button class="danger" onclick={remove}>削除</button>
      {/if}
    </div>
  </div>
{/if}
