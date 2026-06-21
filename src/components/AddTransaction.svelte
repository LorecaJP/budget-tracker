<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from '../lib/supabase'
  import { ymd } from '../lib/month'
  import type { Account, Category, TxType } from '../lib/types'

  interface Props { onclose: () => void; onadded: () => void }
  let { onclose, onadded }: Props = $props()

  let amount = $state<number | null>(null)
  let type = $state<TxType>('expense')
  let categoryId = $state('')
  let accountId = $state('')
  let person = $state('')
  let date = $state(ymd(new Date()))
  let memo = $state('')

  let accounts = $state<Account[]>([])
  let categories = $state<Category[]>([])
  let saving = $state(false)
  let error = $state<string | null>(null)

  const visibleCats = $derived(
    categories.filter(c => (type === 'income' ? c.division === 'income' : c.division !== 'income'))
  )

  onMount(async () => {
    const [aRes, cRes] = await Promise.all([
      supabase.from('accounts').select('*').eq('archived', false).order('sort_order'),
      supabase.from('categories').select('*').eq('archived', false).order('sort_order'),
    ])
    accounts = (aRes.data ?? []) as Account[]
    categories = (cRes.data ?? []) as Category[]
    if (accounts[0]) accountId = accounts[0].id
  })

  async function save() {
    error = null
    if (!amount || amount <= 0) { error = '金額を入力してください'; return }
    saving = true
    const { error: e } = await supabase.from('transactions').insert({
      date,
      amount: Math.round(amount),
      type,
      category_id: categoryId || null,
      account_id: accountId || null,
      person: person || null,
      memo,
      source: 'manual',
    })
    saving = false
    if (e) { error = e.message; return }
    onadded()
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose() }} />
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="取引を入力">
    <div class="sheet-head">
      <button class="link" onclick={onclose}>キャンセル</button>
      <div class="seg">
        <button class:active={type === 'expense'} onclick={() => type = 'expense'}>支出</button>
        <button class:active={type === 'income'} onclick={() => type = 'income'}>収入</button>
      </div>
      <span style="width:64px"></span>
    </div>

    <div class="amount-display">¥{(amount ?? 0).toLocaleString('ja-JP')}</div>
    <input class="amount-input" type="number" inputmode="numeric" bind:value={amount} placeholder="金額を入力" />

    <label class="field">
      <span>カテゴリ</span>
      <select bind:value={categoryId}>
        <option value="">未分類</option>
        {#each visibleCats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>

    <label class="field">
      <span>口座</span>
      <select bind:value={accountId}>
        {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
      </select>
    </label>

    <div class="row2">
      <label class="field">
        <span>人</span>
        <select bind:value={person}>
          <option value="">指定なし</option>
          <option value="ゆうき">ゆうき</option>
          <option value="えみ">えみ</option>
        </select>
      </label>
      <label class="field">
        <span>日付</span>
        <input type="date" bind:value={date} />
      </label>
    </div>

    <label class="field">
      <span>メモ</span>
      <input type="text" bind:value={memo} placeholder="任意" />
    </label>

    {#if error}<p class="msg error">{error}</p>{/if}
    <button class="primary" onclick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
  </div>
</div>
