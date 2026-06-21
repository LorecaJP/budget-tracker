<script lang="ts">
  import { onMount } from 'svelte'
  import { ymd } from '../lib/month'
  import { listAccounts, listCategories, insertTransaction, updateTransaction, deleteTransaction } from '../lib/db'
  import type { Account, Category, TxType, Transaction } from '../lib/types'

  interface Props { onclose: () => void; onsaved: () => void; existing?: Transaction | null }
  let { onclose, onsaved, existing = null }: Props = $props()

  let amount = $state<number | null>(existing ? existing.amount : null)
  let type = $state<TxType>(existing ? existing.type : 'expense')
  let categoryId = $state(existing?.category_id ?? '')
  let accountId = $state(existing?.account_id ?? '')
  let toAccountId = $state(existing?.to_account_id ?? '')
  let person = $state(existing?.person ?? '')
  let date = $state(existing ? existing.date : ymd(new Date()))
  let memo = $state(existing?.memo ?? '')

  let accounts = $state<Account[]>([])
  let categories = $state<Category[]>([])
  let saving = $state(false)
  let error = $state<string | null>(null)

  const visibleCats = $derived(
    categories.filter(c => (type === 'income' ? c.division === 'income' : c.division !== 'income'))
  )

  onMount(async () => {
    accounts = await listAccounts()
    categories = await listCategories()
    if (!accountId && accounts[0]) accountId = accounts[0].id
    if (!toAccountId && accounts[1]) toAccountId = accounts[1].id
  })

  async function save() {
    error = null
    if (!amount || amount <= 0) { error = '金額を入力してください'; return }
    if (type === 'transfer') {
      if (!accountId || !toAccountId) { error = '移動元と移動先の口座を選んでください'; return }
      if (accountId === toAccountId) { error = '移動元と移動先は別の口座にしてください'; return }
    }
    saving = true
    const isTransfer = type === 'transfer'
    const payload = {
      date, amount: Math.round(amount), type,
      category_id: isTransfer ? null : (categoryId || null),
      account_id: accountId || null,
      to_account_id: isTransfer ? toAccountId : null,
      person: isTransfer ? null : (person || null), memo,
    }
    const { error: e } = existing
      ? await updateTransaction(existing.id, payload)
      : await insertTransaction(payload)
    saving = false
    if (e) { error = e.message; return }
    onsaved()
  }

  async function remove() {
    if (!existing) return
    saving = true
    const { error: e } = await deleteTransaction(existing.id)
    saving = false
    if (e) { error = e.message; return }
    onsaved()
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose() }} />
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose() }}>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="取引">
    <div class="sheet-head">
      <button class="link" onclick={onclose}>キャンセル</button>
      <div class="seg">
        <button class:active={type === 'expense'} onclick={() => type = 'expense'}>支出</button>
        <button class:active={type === 'income'} onclick={() => type = 'income'}>収入</button>
        <button class:active={type === 'transfer'} onclick={() => type = 'transfer'}>振替</button>
      </div>
      <span style="width:64px"></span>
    </div>

    <div class="amount-display">¥{(amount ?? 0).toLocaleString('ja-JP')}</div>
    <input class="amount-input" type="number" inputmode="numeric" bind:value={amount} placeholder="金額を入力" />

    {#if type === 'transfer'}
      <label class="field"><span>移動元口座</span>
        <select bind:value={accountId}>
          <option value="">未指定</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>移動先口座</span>
        <select bind:value={toAccountId}>
          <option value="">未指定</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>日付</span>
        <input type="date" bind:value={date} />
      </label>
    {:else}
      <label class="field"><span>カテゴリ</span>
        <select bind:value={categoryId}>
          <option value="">未分類</option>
          {#each visibleCats as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>口座</span>
        <select bind:value={accountId}>
          <option value="">未指定</option>
          {#each accounts as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
      </label>
      <div class="row2">
        <label class="field"><span>人</span>
          <select bind:value={person}>
            <option value="">指定なし</option>
            <option value="ゆうき">ゆうき</option>
            <option value="えみ">えみ</option>
          </select>
        </label>
        <label class="field"><span>日付</span>
          <input type="date" bind:value={date} />
        </label>
      </div>
    {/if}
    <label class="field"><span>メモ</span>
      <input type="text" bind:value={memo} placeholder="任意" />
    </label>

    {#if error}<p class="msg error">{error}</p>{/if}
    <button class="primary" onclick={save} disabled={saving}>{saving ? '保存中…' : existing ? '更新' : '保存'}</button>
    {#if existing}
      <button class="danger" onclick={remove} disabled={saving}>削除</button>
    {/if}
  </div>
</div>
