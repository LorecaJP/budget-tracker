<script lang="ts">
  // 「年間」タブ＝費目×12予算月のマトリクス。月次の内訳はホームに移したのでここは年間専用。
  import YearSummary from './YearSummary.svelte'
</script>

<div class="screen">
  <h1 class="lg-title">年間</h1>
  <YearSummary />
</div>
