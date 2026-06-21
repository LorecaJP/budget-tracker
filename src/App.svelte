<script lang="ts">
  import { session, sessionReady } from './lib/session'
  import { supabase } from './lib/supabase'
  import { ensureSeed } from './lib/seed'
  import Auth from './components/Auth.svelte'
  import Home from './components/Home.svelte'
  import AddTransaction from './components/AddTransaction.svelte'

  let showAdd = $state(false)
  let refreshKey = $state(0)
  let seeded = $state(false)

  // サインイン後、初回だけ初期データ（カテゴリ・口座）を投入
  $effect(() => {
    const s = $session
    if (s && !seeded) {
      seeded = true
      ensureSeed(s.user.id).then((inserted) => { if (inserted) refreshKey++ })
    }
  })

  function onAdded() {
    showAdd = false
    refreshKey++
  }
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
      {#key refreshKey}
        <Home />
      {/key}
    </main>
    <button class="fab" onclick={() => showAdd = true}>＋ 入力する</button>
    {#if showAdd}
      <AddTransaction onclose={() => showAdd = false} onadded={onAdded} />
    {/if}
  </div>
{/if}
