<script lang="ts">
  // 取引の種別・会計区分・カテゴリ名から、行頭の色つき丸アイコンを描く共通部品。
  // 色は区分（収入=緑/固定費=青/税=灰/貯蓄=紫/変動費=橙/振替=灰）、アイコンはカテゴリ名で細分化。
  interface Props { type: string; division?: string | null; name?: string | null }
  let { type, division = null, name = null }: Props = $props()

  function pickColor(): string {
    if (type === 'transfer') return '#9398A0'
    if (type === 'income') return '#1F6F58'
    if (division === 'fixed') return '#2A6DB5'
    if (division === 'tax') return '#8A8A8E'
    if (division === 'saving') return '#7A5AA8'
    return '#E0913B'
  }
  function pickIcon(): string {
    if (type === 'transfer') return 'transfer'
    if (type === 'income') return 'income'
    const n = name ?? ''
    if (/食費|食事|ランチ|外食/.test(n)) return 'food'
    if (/電気/.test(n)) return 'zap'
    if (/水道|浄水/.test(n)) return 'droplet'
    if (/wi-?fi|ネット|通信/i.test(n)) return 'wifi'
    if (/携帯|スマホ|電話/.test(n)) return 'phone'
    if (/家賃|住宅|駐車|住居/.test(n)) return 'home'
    if (/保険/.test(n)) return 'shield'
    if (/ジム|運動|フィット/.test(n)) return 'activity'
    if (/交通|定期|バス|電車|ガソリン/.test(n)) return 'bus'
    if (/おこづかい|小遣|こづかい/.test(n)) return 'wallet'
    if (/交際|飲み|プレゼント/.test(n)) return 'users'
    if (/日用品|消耗品/.test(n)) return 'bag'
    if (/貯金|貯蓄|防衛|積立|年金/.test(n)) return 'piggy'
    if (/税/.test(n)) return 'receipt'
    if (/給料|給与|賞与|ボーナス|収入/.test(n)) return 'income'
    if (division === 'fixed') return 'home'
    if (division === 'tax') return 'receipt'
    if (division === 'saving') return 'piggy'
    return 'cart'
  }
  const color = $derived(pickColor())
  const icon = $derived(pickIcon())
</script>

<span class="tx-ic" style="background:{color}">
  {#if icon === 'income'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
  {:else if icon === 'food'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v6a2 2 0 0 0 4 0V3M6 11v10"/><path d="M18 3c-2 0-3 2.2-3 5s1 4 3 4v9"/></svg>
  {:else if icon === 'zap'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
  {:else if icon === 'droplet'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"/></svg>
  {:else if icon === 'wifi'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.1a6 6 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M12 20h.01"/></svg>
  {:else if icon === 'phone'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/></svg>
  {:else if icon === 'home'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/></svg>
  {:else if icon === 'shield'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
  {:else if icon === 'activity'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
  {:else if icon === 'bus'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="13" rx="2"/><path d="M4 11h16M8 16v3M16 16v3"/><circle cx="8.5" cy="13.5" r="1"/><circle cx="15.5" cy="13.5" r="1"/></svg>
  {:else if icon === 'wallet'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M16 12h.01"/></svg>
  {:else if icon === 'users'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  {:else if icon === 'bag'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>
  {:else if icon === 'piggy'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8.6 3 2 4.5V21h3v-2h4v2h3v-3.5c.6-.5 1-1 1.4-2H22v-4h-2c0-1-.4-1.6-1-2.2V5Z"/><path d="M2 9v1a2 2 0 0 0 2 2M16 11h.01"/></svg>
  {:else if icon === 'receipt'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6"/></svg>
  {:else if icon === 'transfer'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>
  {:else}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
  {/if}
</span>
