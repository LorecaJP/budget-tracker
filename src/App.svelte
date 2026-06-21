<script lang="ts">
  import { session, sessionReady } from './lib/session'
  import { supabase } from './lib/supabase'
  import { ensureSeed } from './lib/seed'
  import Auth from './components/Auth.svelte'
  import Home from './components/Home.svelte'
  import Transactions from './components/Transactions.svelte'
  import Analysis from './components/Analysis.svelte'
  import SpecialExpenses from './components/SpecialExpenses.svelte'
  import Settings from './components/Settings.svelte'
  import AddTransaction from './components/AddTransaction.svelte'

  type Tab = 'home' | 'tx' | 'analysis' | 'special' | 'settings'
  let tab = $state<Tab>('home')
  let showAdd = $state(false)
  let key = $state(0)
  let seeded = $state(false)

  $effect(() => {
    const s = $session
    if (s && !seeded) { seeded = true; ensureSeed(s.user.id).then((i) => { if (i) key++ }) }
  })

  function onSaved() { showAdd = false; key++ }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'ホーム', icon: '🏠' },
    { id: 'tx', label: '取引', icon: '📋' },
    { id: 'analysis', label: '分析', icon: '📊' },
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
      {#key key}
        {#if tab === 'home'}<Home />
        {:else if tab === 'tx'}<Transactions />
        {:else if tab === 'analysis'}<Analysis />
        {:else if tab === 'special'}<SpecialExpenses />
        {:else if tab === 'settings'}<Settings />{/if}
      {/key}
    </main>

    {#if tab === 'home' || tab === 'tx'}
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
