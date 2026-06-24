<script lang="ts">
  import { supabase } from '../lib/supabase'

  let email = $state('')
  let password = $state('')
  let mode = $state<'in' | 'up'>('in')
  let busy = $state(false)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)

  async function submit() {
    busy = true; error = null; notice = null
    const res = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    busy = false
    if (res.error) { error = res.error.message; return }
    if (mode === 'up') notice = '確認メールを送りました。リンクを開いてから、サインインしてください。'
  }
</script>

<div class="auth-wrap">
  <div class="auth-card">
    <h1 class="auth-title">yutori</h1>
    <p class="auth-sub">{mode === 'in' ? 'サインイン' : 'アカウント作成'}</p>

    <label class="field">
      <span>メールアドレス</span>
      <input type="email" bind:value={email} autocomplete="email" />
    </label>
    <label class="field">
      <span>パスワード</span>
      <input type="password" bind:value={password} autocomplete="current-password" />
    </label>

    {#if error}<p class="msg error">{error}</p>{/if}
    {#if notice}<p class="msg notice">{notice}</p>{/if}

    <button class="primary" onclick={submit} disabled={busy}>
      {busy ? '処理中…' : mode === 'in' ? 'サインイン' : '登録する'}
    </button>

    <button class="link" onclick={() => { mode = mode === 'in' ? 'up' : 'in'; error = null; notice = null }}>
      {mode === 'in' ? 'アカウントを作る' : 'サインインに戻る'}
    </button>
  </div>
</div>
