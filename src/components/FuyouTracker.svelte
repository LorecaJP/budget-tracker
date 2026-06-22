<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { getFuyouConfig, listEmiSalaryYear, listPayslipDetails, type FuyouConfig, type PayslipDetail } from '../lib/db'
  import type { Transaction } from '../lib/types'

  // 社会保険(106万)の月次トリガー目安：月8.8万円（参考表示）
  const SHAHO_MONTH_LINE = 88000
  const WEEKS_PER_MONTH = 52 / 12
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

  const now = new Date()
  let year = $state(now.getFullYear())
  let cfg = $state<FuyouConfig>({ hourly_wage: 1180, year_cap: 1030000 })
  let txs = $state<Transaction[]>([])
  let details = $state<PayslipDetail[]>([])
  let loading = $state(true)

  async function load() {
    loading = true
    cfg = await getFuyouConfig()
    txs = await listEmiSalaryYear(year)
    details = await listPayslipDetails(year)
    loading = false
  }
  onMount(load)
  function go(d: number) { year += d; load() }

  // 総支給（取引）を暦月ごとに集計
  const grossM = $derived.by(() => {
    const a = new Array(12).fill(0) as number[]
    for (const t of txs) { const m = Number(t.date.slice(5, 7)); if (m >= 1 && m <= 12) a[m - 1] += t.amount }
    return a
  })
  // 明細の追加項目（通勤手当・総労働時間）を暦月ごとに集計
  const detM = $derived.by(() => {
    const a = Array.from({ length: 12 }, () => ({ commute: null as number | null, minutes: null as number | null }))
    for (const d of details) {
      const m = Number(d.pay_date.slice(5, 7)); if (m < 1 || m > 12) continue
      const c = a[m - 1]
      if (d.commute != null) c.commute = (c.commute ?? 0) + d.commute
      if (d.work_minutes != null) c.minutes = (c.minutes ?? 0) + d.work_minutes
    }
    return a
  })

  const cap = $derived(cfg.year_cap)
  const wage = $derived(cfg.hourly_wage)
  const grossYtd = $derived(grossM.reduce((s, n) => s + n, 0))
  const commuteYtd = $derived(detM.reduce((s, c) => s + (c.commute ?? 0), 0))
  // 課税支給額＝総支給−通勤手当（明細の「課税支給額」は年内累計のため合算には使わない）
  const taxableYtd = $derived(grossYtd - commuteYtd)
  const minutesYtd = $derived(detM.reduce((s, c) => s + (c.minutes ?? 0), 0))
  const hasCommute = $derived(detM.some(c => c.commute != null))
  const monthsWithHours = $derived(detM.filter(c => c.minutes != null).length)
  const totalHours = $derived(minutesYtd / 60)
  const weeklyAvgHours = $derived(monthsWithHours > 0 ? (totalHours / monthsWithHours) / WEEKS_PER_MONTH : 0)

  // 上限判定は課税支給額ベース
  const base = $derived(taxableYtd)
  const over = $derived(base > cap)
  const overage = $derived(Math.max(0, base - cap))
  const remaining = $derived(Math.max(0, cap - base))
  const pct = $derived(cap > 0 ? Math.min(100, Math.round((base / cap) * 100)) : 0)
  const ratioPct = $derived(cap > 0 ? Math.round((base / cap) * 100) : 0)   // 超過時は100超
  const remainHours = $derived(wage > 0 ? Math.floor(remaining / wage) : 0)
  const paidMonths = $derived(grossM.filter(v => v > 0).length)
  const projected = $derived(paidMonths > 0 ? Math.round((base / paidMonths) * 12) : 0)
  const isThisYear = $derived(year === now.getFullYear())

  // 信号（緑〜79% / 黄80〜95% / 赤96%〜）とメッセージ
  const signal = $derived(over || ratioPct >= 96 ? 'red' : ratioPct >= 80 ? 'amber' : 'green')
  const message = $derived(over ? '超えちゃった' : ratioPct >= 96 ? 'もうギリギリ' : ratioPct >= 80 ? 'そろそろ気をつけてね' : 'まだまだ大丈夫')

  // 残りの月数（今年のみ）で割った1ヶ月あたりの目安。今月が未払いなら含める。
  const curMonth = now.getMonth() + 1
  const monthsLeft = $derived(isThisYear ? Math.max(0, 12 - curMonth + (grossM[curMonth - 1] > 0 ? 0 : 1)) : (year > now.getFullYear() ? 12 : 0))
  const perMonthYen = $derived(monthsLeft > 0 ? Math.round(remaining / monthsLeft) : 0)
  const perMonthHours = $derived(monthsLeft > 0 ? Math.floor(remainHours / monthsLeft) : 0)
</script>

{#snippet clockIcon()}
  <svg class="fy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
{/snippet}
{#snippet yenIcon()}
  <svg class="fy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
{/snippet}

<div class="screen">
  <div class="month-nav">
    <button class="nav-btn" onclick={() => go(-1)} aria-label="前の年">‹</button>
    <span class="month-title">{year}年（暦年）</span>
    <button class="nav-btn" onclick={() => go(1)} aria-label="次の年">›</button>
  </div>

  {#if loading}
    <p class="state">集計中…</p>
  {:else}
    <section class="card">
      <div class="card-label">えみ 扶養トラッカー（上限 {yen(cap)}）</div>
      <div class="fy-head">
        <span class="fy-dots">
          <i class="g" class:on={signal === 'green'}></i>
          <i class="a" class:on={signal === 'amber'}></i>
          <i class="r" class:on={signal === 'red'}></i>
        </span>
        <span class="fy-msg" class:g={signal === 'green'} class:a={signal === 'amber'} class:r={signal === 'red'}>{message}</span>
      </div>
      <hr class="fy-hr" />

      <div class="fy-gl">今年あと</div>
      <div class="fy-row">
        <div class="fy-tile {over ? 'off' : 'time'}">{@render clockIcon()}<span class="fy-num">{over ? '0' : remainHours.toLocaleString('ja-JP')}<small>時間</small></span></div>
        <div class="fy-tile {over ? 'off' : 'money'}">{@render yenIcon()}<span class="fy-num">{over ? '¥0' : yen(remaining)}</span></div>
      </div>
      <div class="fy-gl mt">1ヶ月あたりあと</div>
      <div class="fy-row">
        <div class="fy-tile {over ? 'off' : 'time'}">{@render clockIcon()}<span class="fy-num">{over || monthsLeft === 0 ? '0' : perMonthHours.toLocaleString('ja-JP')}<small>時間</small></span></div>
        <div class="fy-tile {over ? 'off' : 'money'}">{@render yenIcon()}<span class="fy-num">{over || monthsLeft === 0 ? '¥0' : yen(perMonthYen)}</span></div>
      </div>

      {#if over}
        <div class="fy-over">⚠️ 上限を {yen(overage)} 超えています</div>
      {/if}

      <div class="bp-track" style="margin-top:14px"><div class="bp-fill {signal}" style="width:{pct}%"></div></div>
      <div class="fy-capnote"><span>{Math.round(cap / 10000).toLocaleString('ja-JP')}万円まで</span><span>{ratioPct}%</span></div>
    </section>

    <section class="card">
      <div class="card-label">明細</div>
      <div class="fy-kv"><span class="k">課税支給額</span><span class="v">{yen(taxableYtd)} / {yen(cap)}</span></div>
      <div class="fy-kv"><span class="k">総支給（参考）</span><span class="v">{yen(grossYtd)}</span></div>
      {#if hasCommute}
        <div class="fy-kv"><span class="k">通勤手当</span><span class="v">{yen(commuteYtd)}</span></div>
      {/if}
      {#if minutesYtd > 0}
        <div class="fy-kv"><span class="k">総労働時間</span><span class="v {weeklyAvgHours >= 20 ? 'neg' : ''}">{Math.round(totalHours).toLocaleString('ja-JP')}時間（週平均{weeklyAvgHours.toFixed(1)}h）</span></div>
      {/if}
      {#if isThisYear && projected > 0}
        <div class="fy-kv"><span class="k">年間の見込み</span><span class="v {projected > cap ? 'neg' : ''}">{yen(projected)}</span></div>
      {/if}
      {#if hasCommute || minutesYtd > 0}
        <p class="fy-note">通勤手当・総労働時間は取込済みの月の合計です。</p>
      {/if}
    </section>

    <div class="day-head"><span>月別のえみ給料（総支給）</span><span>社保の月8.8万ライン</span></div>
    <ul class="tx-list">
      {#each MONTHS as m (m)}
        <li class="tx-row">
          <div class="tx-main">
            <span class="tx-name">{m}月</span>
            <span class="tx-sub">{grossM[m - 1] > SHAHO_MONTH_LINE ? '⚠️ 月8.8万超' : grossM[m - 1] > 0 ? 'OK' : '—'}{detM[m - 1].minutes != null ? ` · ${(detM[m - 1].minutes! / 60).toFixed(0)}時間` : ''}</span>
          </div>
          <span class="tx-amt {grossM[m - 1] > SHAHO_MONTH_LINE ? 'neg' : ''}">{grossM[m - 1] ? yen(grossM[m - 1]) : '−'}</span>
        </li>
      {/each}
    </ul>

    <p class="hint">暦年（1〜12月）・支給日ベースで集計（年末調整還付は報酬ではないため対象外）。<strong>上限判定は課税支給額（通勤手当を除く＝103万手当・税の正しい基準）</strong>。明細を取り込むと課税支給額・通勤手当・総労働時間が自動で貯まります（未取込の月は総支給で代用）。「1ヶ月あたり」は今年の残りを残り月数で割った目安です。</p>
    <p class="hint">⚠️ 社保は別軸：2026年9月までは「週20時間以上＋月8.8万円以上」、<strong>2026年10月からは賃金要件が撤廃され「週20時間以上」だけ</strong>で加入対象。総労働時間の週平均が20時間に近いか要注意。時給・上限は設定タブで変更できます。</p>
  {/if}
</div>
