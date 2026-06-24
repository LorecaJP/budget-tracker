<script lang="ts">
  import { session, sessionReady } from './lib/session'
  import { supabase } from './lib/supabase'
  import { ensureSeed } from './lib/seed'
  import { getSettings, getMyMembership, type Membership } from './lib/db'
  import { setMonthStartDay } from './lib/month'
  import Auth from './components/Auth.svelte'
  import Home from './components/Home.svelte'
  import Transactions from './components/Transactions.svelte'
  import Reports from './components/Reports.svelte'
  import Prepare from './components/Prepare.svelte'
  import FuyouTracker from './components/FuyouTracker.svelte'
  import Settings from './components/Settings.svelte'
  import AddTransaction from './components/AddTransaction.svelte'

  type Tab = 'home' | 'tx' | 'reports' | 'prepare' | 'fuyou' | 'settings'
  let tab = $state<Tab>('home')
  let showAdd = $state(false)
  let key = $state(0)
  let booted = $state(false)
  let ready = $state(false)
  let membership = $state<Membership | null>(null)

  $effect(() => {
    const s = $session
    if (s && !booted) { booted = true; boot(s.user.id) }
  })

  // 起動時：設定（月開始日）を反映してからシードし、各画面を描画する。
  // 失敗しても既定（25日始まり）で必ず描画に進む。
  async function boot(userId: string) {
    try {
      membership = await getMyMembership(userId)        // 未連携(=単一ユーザー)なら null → 全画面表示
      if (membership?.person === 'えみ') tab = 'fuyou'  // えみは扶養をトップに
      const st = await getSettings()
      if (st?.month_start_day) setMonthStartDay(st.month_start_day)
      // えみ（member）では初期データを投入しない（世帯データと重複するため）。owner/未連携のみシード。
      if (!membership || membership.role === 'owner') await ensureSeed(userId)
    } catch (e) {
      console.error('boot failed', e)
    } finally {
      ready = true
    }
  }

  function onSaved() { showAdd = false; key++ }

  const TAB_LABELS: Record<Tab, string> = {
    home: 'ホーム', tx: '取引', reports: 'ふりかえり', prepare: 'そなえ', fuyou: '扶養', settings: '設定',
  }
  // 表示タブを人別に出し分け（えみ＝扶養トップ＋楽天など複雑なタブを隠したシンプル表示）。
  const TABS_FULL: Tab[] = ['home', 'tx', 'reports', 'prepare', 'fuyou', 'settings']
  const TABS_EMI: Tab[] = ['fuyou', 'home', 'tx', 'settings']
  const tabIds = $derived(membership?.person === 'えみ' ? TABS_EMI : TABS_FULL)
</script>

{#snippet tabIcon(id: Tab)}
  {#if id === 'home'}
    <svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/></svg>
  {:else if id === 'tx'}
    <svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>
  {:else if id === 'reports'}
    <svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14v4M12 9v9M17 5v13"/></svg>
  {:else if id === 'prepare'}
    <svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>
  {:else if id === 'fuyou'}
    <svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>
  {:else if id === 'settings'}
    <svg class="tab-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
  {/if}
{/snippet}

{#if !$sessionReady}
  <div class="boot">読み込み中…</div>
{:else if !$session}
  <Auth />
{:else}
  <div class="app">
    <header class="topbar">
      <span class="brand">yutori</span>
      <button class="link" onclick={() => supabase.auth.signOut()}>サインアウト</button>
    </header>

    <main class="content">
      {#if !ready}
        <p class="boot">読み込み中…</p>
      {:else}
        {#key key}
          {#if tab === 'home'}<Home />
          {:else if tab === 'tx'}<Transactions />
          {:else if tab === 'reports'}<Reports />
          {:else if tab === 'prepare'}<Prepare />
          {:else if tab === 'fuyou'}<FuyouTracker />
          {:else if tab === 'settings'}<Settings />{/if}
        {/key}
      {/if}
    </main>

    {#if ready && (tab === 'home' || tab === 'tx')}
      <button class="fab" onclick={() => showAdd = true}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>入力
      </button>
    {/if}

    <nav class="tabbar">
      {#each tabIds as id}
        <button class="tab {tab === id ? 'active' : ''}" onclick={() => tab = id}>
          {@render tabIcon(id)}
          <span class="tab-label">{TAB_LABELS[id]}</span>
        </button>
      {/each}
    </nav>

    {#if showAdd}
      <AddTransaction onclose={() => showAdd = false} onsaved={onSaved} />
    {/if}
  </div>
{/if}
