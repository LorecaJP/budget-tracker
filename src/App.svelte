<script lang="ts">
  import { session, sessionReady } from './lib/session'
  import { supabase } from './lib/supabase'
  import { ensureSeed } from './lib/seed'
  import { getSettings } from './lib/db'
  import { setMonthStartDay } from './lib/month'
  import Auth from './components/Auth.svelte'
  import Home from './components/Home.svelte'
  import Transactions from './components/Transactions.svelte'
  import Analysis from './components/Analysis.svelte'
  import YearSummary from './components/YearSummary.svelte'
  import SpecialExpenses from './components/SpecialExpenses.svelte'
  import Settings from './components/Settings.svelte'
  import AddTransaction from './components/AddTransaction.svelte'

  type Tab = 'home' | 'tx' | 'analysis' | 'year' | 'special' | 'settings'
  let tab = $state<Tab>('home')
  let showAdd = $state(false)
  let key = $state(0)
  let booted = $state(false)
  let ready = $state(false)

  $effect(() => {
    const s = $session
    if (s && !booted) { booted = true; boot(s.user.id) }
  })

  // 起動時：設定（月開始日）を反映してからシードし、各画面を描画する。
  // 失敗しても既定（25日始まり）で必ず描画に進む。
  async function boot(userId: string) {
    try {
      const st = await getSettings()
      if (st?.month_start_day) setMonthStartDay(st.month_start_day)
      await ensureSeed(userId)
    } catch (e) {
      console.error('boot failed', e)
    } finally {
      ready = true
    }
  }

  function onSaved() { showAdd = false; key++ }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'ホーム', icon: '🏠' },
    { id: 'tx', label: '取引', icon: '📋' },
    { id: 'analysis', label: '分析', icon: '📊' },
    { id: 'year', label: '年間', icon: '📈' },
    { id: 'special', label: '特別費', icon: '📅' },
    { id: 'settings', label: '設定', icon: '⚙️' },
  ]
</script>

{#if !$sessionReady}
  <div class="boot">読み込み中…</div>
{:else if !$session}
  <Auth />
{:else}
  <div class="app">
    <header class="topbar">
      <span class="brand">家計簿</span>
      <button class="link" onclick={() => supabase.auth.signOut()}>サインアウト</button>
    </header>

    <main class="content">
      {#if !ready}
        <p class="boot">読み込み中…</p>
      {:else}
        {#key key}
          {#if tab === 'home'}<Home />
          {:else if tab === 'tx'}<Transactions />
          {:else if tab === 'analysis'}<Analysis />
          {:else if tab === 'year'}<YearSummary />
          {:else if tab === 'special'}<SpecialExpenses />
          {:else if tab === 'settings'}<Settings />{/if}
        {/key}
      {/if}
    </main>

    {#if ready && (tab === 'home' || tab === 'tx')}
      <button class="fab" onclick={() => showAdd = true}>＋ 入力する</button>
    {/if}

    <nav class="tabbar">
      {#each TABS as t}
        <button class="tab {tab === t.id ? 'active' : ''}" onclick={() => tab = t.id}>
          <span class="tab-icon">{t.icon}</span><span class="tab-label">{t.label}</span>
        </button>
      {/each}
    </nav>

    {#if showAdd}
      <AddTransaction onclose={() => showAdd = false} onsaved={onSaved} />
    {/if}
  </div>
{/if}
