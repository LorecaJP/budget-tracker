<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { listCategories, sumSavingByCategory } from '../lib/db'
  import MonthlyBreakdown from './MonthlyBreakdown.svelte'

  // ホームは「今月まるごと」ダッシュボード（収入・支出の内訳＋残り）＝ MonthlyBreakdown。
  // その下に貯金の目標を表示する。
  let savingGoals = $state<{ name: string; goal: number; saved: number }[]>([])

  async function loadGoals() {
    const cl = await listCategories()
    const goals = cl.filter(c => !c.archived && c.division === 'saving' && (c.goal_amount ?? 0) > 0)
    const totals = await sumSavingByCategory(goals.map(c => c.id))
    savingGoals = goals
      .map(c => ({ name: c.name, goal: c.goal_amount as number, saved: totals[c.id] ?? 0 }))
      .sort((a, b) => b.goal - a.goal)
  }
  onMount(loadGoals)
</script>

<div class="screen">
  <h1 class="lg-title">ホーム</h1>

  <MonthlyBreakdown />

  {#if savingGoals.length}
    <div class="sec-head">貯金の目標</div>
    <section class="card">
      {#each savingGoals as g}
        <div class="bp">
          <div class="bp-head"><span>{g.name}</span><span class="num">{yen(g.saved)} / {yen(g.goal)}（{g.goal > 0 ? Math.round((g.saved / g.goal) * 100) : 0}%）</span></div>
          <div class="bp-track"><div class="bp-fill" style="width:{Math.min(100, g.goal > 0 ? (g.saved / g.goal) * 100 : 0)}%"></div></div>
        </div>
      {/each}
    </section>
  {/if}
</div>
