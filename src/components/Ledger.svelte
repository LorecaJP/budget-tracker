<script lang="ts">
  import MonthlyBreakdown from './MonthlyBreakdown.svelte'
  import YearSummary from './YearSummary.svelte'

  let mode = $state<'month' | 'year'>('month')
</script>

<div class="screen">
  <h1 class="lg-title">収支</h1>
  <div class="seg seg-wide ledger-seg">
    <button class:active={mode === 'month'} onclick={() => mode = 'month'}>月次</button>
    <button class:active={mode === 'year'} onclick={() => mode = 'year'}>年間</button>
  </div>

  {#if mode === 'month'}
    <MonthlyBreakdown />
  {:else}
    <YearSummary />
  {/if}
</div>
