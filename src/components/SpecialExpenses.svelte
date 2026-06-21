<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { listSpecialExpenses, upsertSpecialExpense, deleteSpecialExpense, type SpecialExpense } from '../lib/db'
  import { session } from '../lib/session'

  let year = $state(new Date().getFullYear())
  let items = $state<SpecialExpense[]>([])
  let loading = $state(true)
  let editing = $state<Partial<SpecialExpense> | null>(null)

  const totalBudget = $derived(items.reduce((s, x) => s + (x.budget_amount || 0), 0))
  const monthlyReserve = $derived(Math.round(totalBudget / 12))
  const byMonth = $derived.by(() => {
    const m = new Map<number, SpecialExpense[]>()
    for (const x of items) {
      if (!m.has(x.planned_month)) m.set(x.planned_month, [])
      m.get(x.planned_month)!.push(x)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  })

  async function load() { loading = true; items = await listSpecialExpenses(year); loading = false }
  onMount(load)

  function newItem() { editing = { name: '', planned_month: 1, budget_amount: 0, actual_amount: null, is_reserved: true, year } }
  async function save() {
    if (!editing) return
    const uid = $session?.user.id
    await upsertSpecialExpense({ ...editing, year, user_id: uid })
    editing = null; load()
  }
  async function remove() {
    if (editing?.id) await deleteSpecialExpense(editing.id)
    editing = null; load()
  }
</script>

<div class="screen">
  <div class="month-nav">
    <button class="nav-btn" onclick={() => { year--; load() }} aria-label="前の年">‹</button>
    <span class="month-title">{year}年の特別費</span>
    <button class="nav-btn" onclick={() => { year++; load() }} aria-label="次の年">›</button>
  </div>

  <section class="card">
    <div class="kv"><span>年間の特別費</span><span class="num" style="font-weight:600">{yen(totalBudget)}</span></div>
    <div class="reserve"><span>毎月の積立目安</span><span class="num pos" style="font-weight:600">{yen(monthlyReserve)}</span></div>
  </section>

  {#if loading}
    <p class="state">読み込み中…</p>
  {:else if items.length === 0}
    <p class="state">特別費はまだありません。「＋ 追加」から登録しましょう。</p>
  {:else}
    {#each byMonth as [m, list] (m)}
      <div class="day-head"><span>{m}月</span></div>
      <ul class="tx-list">
        {#each list as x (x.id)}
          <li class="tx-row tappable" onclick={() => editing = { ...x }}>
            <div class="tx-main">
              <span class="tx-name">{x.name}</span>
              <span class="tx-sub">予算 {yen(x.budget_amount)}{x.is_reserved ? ' · 積立対象' : ''}</span>
            </div>
            <span class="tx-amt {x.actual_amount != null ? 'neg' : ''}">{x.actual_amount != null ? yen(x.actual_amount) : '予定'}</span>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}

  <button class="add-inline" onclick={newItem}>＋ 追加</button>
</div>

{#if editing}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) editing = null }}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><button class="link" onclick={() => editing = null}>キャンセル</button><span></span><span></span></div>
      <label class="field"><span>費目名</span><input type="text" bind:value={editing.name} placeholder="自動車税 など" /></label>
      <div class="row2">
        <label class="field"><span>予定月</span>
          <select bind:value={editing.planned_month}>
            {#each Array.from({ length: 12 }) as _, i}<option value={i + 1}>{i + 1}月</option>{/each}
          </select>
        </label>
        <label class="field"><span>予算</span><input type="number" inputmode="numeric" bind:value={editing.budget_amount} /></label>
      </div>
      <label class="field"><span>実績（支払い済みなら入力）</span><input type="number" inputmode="numeric" bind:value={editing.actual_amount} placeholder="未払いなら空" /></label>
      <label class="check"><input type="checkbox" bind:checked={editing.is_reserved} /> 積立の対象にする</label>
      <button class="primary" onclick={save}>保存</button>
      {#if editing.id}<button class="danger" onclick={remove}>削除</button>{/if}
    </div>
  </div>
{/if}
