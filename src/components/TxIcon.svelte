<script lang="ts">
  // 取引の種別・会計区分から、行頭の色つき丸アイコンを描く共通部品。
  interface Props { type: string; division?: string | null }
  let { type, division = null }: Props = $props()
  const k = $derived.by(() => {
    if (type === 'transfer') return { c: '#9398A0', i: 'transfer' }
    if (type === 'income') return { c: '#1F6F58', i: 'income' }
    if (division === 'fixed') return { c: '#2A6DB5', i: 'home' }
    if (division === 'tax') return { c: '#8A8A8E', i: 'receipt' }
    if (division === 'saving') return { c: '#7A5AA8', i: 'coins' }
    return { c: '#E0913B', i: 'cart' }
  })
</script>

<span class="tx-ic" style="background:{k.c}">
  {#if k.i === 'income'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
  {:else if k.i === 'cart'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
  {:else if k.i === 'home'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/></svg>
  {:else if k.i === 'receipt'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6"/></svg>
  {:else if k.i === 'coins'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6"/><path d="M15 7.5a6 6 0 1 1 0 9"/></svg>
  {:else if k.i === 'transfer'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
  {/if}
</span>
