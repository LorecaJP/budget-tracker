<script lang="ts">
  import { supabase } from '../lib/supabase'

  let email = $state('')
  let password = $state('')
  let mode = $state<'in' | 'up'>('in')
  let busy = $state(false)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)

  // Supabaseの英語エラーを、原因が分かる日本語に変換する。
  // 特に「Load failed / Failed to fetch」＝サーバー未到達（無料枠の自動停止など）を明示する。
  function friendly(msg: string): string {
    const m = msg.toLowerCase()
    if (m.includes('load failed') || m.includes('failed to fetch') ||
        m.includes('networkerror') || m.includes('network request failed') || m.includes('fetch')) {
      return 'サーバーに接続できませんでした。時間をおいて、もう一度お試しください。（家計簿のデータベースが一時停止している可能性があります）'
    }
    if (m.includes('invalid login credentials')) return 'メールアドレスかパスワードが違います。'
    if (m.includes('email not confirmed')) return 'メール確認が完了していません。登録時の確認メールのリンクを開いてから、サインインしてください。'
    if (m.includes('rate limit') || m.includes('too many')) return '試行回数が多すぎます。しばらく待ってから、もう一度お試しください。'
    if (m.includes('user already registered')) return 'このメールアドレスは既に登録済みです。「サインインに戻る」からサインインしてください。'
    return msg
  }

  async function submit() {
    busy = true; error = null; notice = null
    try {
      const res = mode === 'in'
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password })
      if (res.error) { error = friendly(res.error.message); return }
      if (mode === 'up') notice = '確認メールを送りました。リンクを開いてから、サインインしてください。'
    } catch (e) {
      // ネットワーク例外が res.error ではなく throw される場合の保険。
      error = friendly(e instanceof Error ? e.message : String(e))
    } finally {
      busy = false
    }
  }
</script>

<div class="auth-wrap">
  <div class="auth-card">
    <h1 class="auth-title">yutori</h1>
    <p class="auth-sub">{mode === 'in' ? 'サインイン' : 'アカウント作成'}</p>

    <label class="field">
      <span>メールアドレス</span>
      <input type="email" bind:value={email} autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="email" />
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
