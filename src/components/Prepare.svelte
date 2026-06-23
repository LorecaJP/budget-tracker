<script lang="ts">
  // 「そなえ」タブ：支払い予定・特別費をセグメントで束ねる薄い親（各画面はそのまま再利用）。
  import UpcomingPayments from './UpcomingPayments.svelte'
  import SpecialExpenses from './SpecialExpenses.svelte'

  type Sub = 'pay' | 'special'
  let sub = $state<Sub>((localStorage.getItem('prepare_sub') as Sub) || 'pay')
  $effect(() => localStorage.setItem('prepare_sub', sub))
</script>

<div class="screen">
  <div class="seg seg-wide">
    <button class={sub === 'pay' ? 'active' : ''} onclick={() => sub = 'pay'}>支払い</button>
    <button class={sub === 'special' ? 'active' : ''} onclick={() => sub = 'special'}>特別費</button>
  </div>
</div>
{#if sub === 'pay'}<UpcomingPayments />{:else}<SpecialExpenses />{/if}
