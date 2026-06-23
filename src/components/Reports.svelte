<script lang="ts">
  // 「ふりかえり」タブ：分析・年間・楽天をセグメントで束ねる薄い親（各画面はそのまま再利用）。
  import Analysis from './Analysis.svelte'
  import Ledger from './Ledger.svelte'
  import RakutenCard from './RakutenCard.svelte'

  type Sub = 'analysis' | 'year' | 'rakuten'
  let sub = $state<Sub>((localStorage.getItem('reports_sub') as Sub) || 'analysis')
  $effect(() => localStorage.setItem('reports_sub', sub))
</script>

<div class="screen">
  <div class="seg seg-wide">
    <button class={sub === 'analysis' ? 'active' : ''} onclick={() => sub = 'analysis'}>分析</button>
    <button class={sub === 'year' ? 'active' : ''} onclick={() => sub = 'year'}>年間</button>
    <button class={sub === 'rakuten' ? 'active' : ''} onclick={() => sub = 'rakuten'}>楽天</button>
  </div>
</div>
{#if sub === 'analysis'}<Analysis />{:else if sub === 'year'}<Ledger />{:else}<RakutenCard />{/if}
