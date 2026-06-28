<script lang="ts">
  import { onMount } from 'svelte'
  import { yen } from '../lib/month'
  import { getFuyouConfig, listEmiSalaryYear, listPayslipDetails, listFuyouOverrides, setFuyouOverride, listShifts, type FuyouConfig, type PayslipDetail, type FuyouOverride, type Shift } from '../lib/db'
  import type { Transaction } from '../lib/types'
  import ShiftPlanner from './ShiftPlanner.svelte'

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
  let estimateTotal = $state(0)   // ShiftPlanner から受け取る「見込み（未受給）」の合計
  let overrides = $state<FuyouOverride[]>([])
  let shifts = $state<Shift[]>([])   // 月別リストにシフト由来の見込みを出すため（ShiftPlanner と同じデータ）
  let shiftKey = $state(0)        // 手動見込みを変えたら ShiftPlanner を再マウントして再集計
  let estM = $state<number | null>(null)   // 見込み編集中の支給月（1-12）
  let estH = $state(0)
  let estMin = $state(0)

  async function load() {
    loading = true
    cfg = await getFuyouConfig()
    txs = await listEmiSalaryYear(year)
    details = await listPayslipDetails(year)
    overrides = await listFuyouOverrides()
    shifts = await listShifts(`${year - 1}-12-01`, `${year}-12-01`)   // 支給月1〜12 ＝ 就労月 前年12〜当年11
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
  const received = $derived(grossM.map(v => v > 0))   // 支給月ごとに実給与が入っているか（見込みの二重計上回避に使う）
  const grossYtd = $derived(grossM.reduce((s, n) => s + n, 0))
  const commuteYtd = $derived(detM.reduce((s, c) => s + (c.commute ?? 0), 0))
  // 課税支給額＝総支給−通勤手当（明細の「課税支給額」は年内累計のため合算には使わない）
  const taxableYtd = $derived(grossYtd - commuteYtd)
  const minutesYtd = $derived(detM.reduce((s, c) => s + (c.minutes ?? 0), 0))
  const hasCommute = $derived(detM.some(c => c.commute != null))
  const monthsWithHours = $derived(detM.filter(c => c.minutes != null).length)
  const totalHours = $derived(minutesYtd / 60)
  const weeklyAvgHours = $derived(monthsWithHours > 0 ? (totalHours / monthsWithHours) / WEEKS_PER_MONTH : 0)

  // 上限判定は課税支給額ベース。確定（受給済み）＋見込み（未受給）で「あと働ける」を出す。
  const base = $derived(taxableYtd + estimateTotal)
  const over = $derived(base > cap)
  const overage = $derived(Math.max(0, base - cap))
  const remaining = $derived(Math.max(0, cap - base))
  const pct = $derived(cap > 0 ? Math.min(100, Math.round((base / cap) * 100)) : 0)
  const ratioPct = $derived(cap > 0 ? Math.round((base / cap) * 100) : 0)   // 超過時は100超
  const remainHours = $derived(wage > 0 ? Math.floor(remaining / wage) : 0)
  const paidMonths = $derived(grossM.filter(v => v > 0).length)
  const projected = $derived(paidMonths > 0 ? Math.round((taxableYtd / paidMonths) * 12) : 0)
  const isThisYear = $derived(year === now.getFullYear())

  // 信号（緑〜79% / 黄80〜95% / 赤96%〜）とメッセージ
  const signal = $derived(over || ratioPct >= 96 ? 'red' : ratioPct >= 80 ? 'amber' : 'green')
  const message = $derived(over ? '超えちゃった' : ratioPct >= 96 ? 'もうギリギリ' : ratioPct >= 80 ? 'そろそろ気をつけてね' : 'まだまだ大丈夫')

  // 残りの月数（今年のみ）で割った1ヶ月あたりの目安。今月が未払いなら含める。
  const curMonth = now.getMonth() + 1
  const monthsLeft = $derived(isThisYear ? Math.max(0, 12 - curMonth + (grossM[curMonth - 1] > 0 ? 0 : 1)) : (year > now.getFullYear() ? 12 : 0))
  const perMonthYen = $derived(monthsLeft > 0 ? Math.round(remaining / monthsLeft) : 0)
  const perMonthHours = $derived(monthsLeft > 0 ? Math.floor(remainHours / monthsLeft) : 0)

  // 月別リストから「見込み」を手動入力（その支給月＝就労月の翌月。就労月の override に保存）。
  const pad2 = (n: number) => String(n).padStart(2, '0')
  function workMonthOfPay(p: number) { return p === 1 ? `${year - 1}-12` : `${year}-${pad2(p - 1)}` }
  function overrideFor(p: number): number | null { return overrides.find(o => o.work_month === workMonthOfPay(p))?.amount ?? null }
  // 就労シフトから支給月ごとの見込み時間（支給月 p の就労月＝p−1 月）
  const shiftHoursByPay = $derived.by(() => {
    const a = new Array(12).fill(0) as number[]
    for (let p = 1; p <= 12; p++) {
      const wm = workMonthOfPay(p)
      a[p - 1] = shifts.filter(s => s.work_date.slice(0, 7) === wm)
        .reduce((sum, s) => sum + Math.max(0, (s.end_min - s.start_min - (s.break_min ?? 0)) / 60), 0)
    }
    return a
  })
  // 支給月 p の見込み（円）。受給済みは0。手動上書き優先、無ければシフト×時給。
  function estFor(p: number): number {
    if (grossM[p - 1] > 0) return 0
    return overrideFor(p) ?? Math.round(shiftHoursByPay[p - 1] * wage)
  }
  function isManualEst(p: number): boolean { return grossM[p - 1] === 0 && overrideFor(p) != null }
  const estAmt = $derived(Math.round((estH + estMin / 60) * wage))   // 入力時間 × 時給
  function openEst(p: number) {
    if (grossM[p - 1] > 0) return            // 受給済みの月は編集しない
    estM = estM === p ? null : p
    const cur = estFor(p)                    // 手動上書き ／ 無ければシフト由来の見込みを初期値に
    if (cur > 0 && wage > 0) { const h = cur / wage; estH = Math.floor(h); estMin = Math.round((h - estH) * 60) }
    else { estH = 0; estMin = 0 }
  }
  async function saveEst(p: number) {
    await setFuyouOverride(workMonthOfPay(p), estAmt)
    estM = null
    overrides = await listFuyouOverrides()
    shiftKey++
  }
  async function clearEst(p: number) {
    await setFuyouOverride(workMonthOfPay(p), null)
    estM = null
    overrides = await listFuyouOverrides()
    shiftKey++
  }
</script>

{#snippet clockIcon()}
  <svg class="fy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
{/snippet}
{#snippet yenIcon()}
  <svg class="fy-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
{/snippet}

<div class="screen">
  <h1 class="lg-title">扶養</h1>
  <div class="month-nav">
    <button class="nav-btn" onclick={() => go(-1)} aria-label="前の年">‹</button>
    <span class="month-title">{year}年</span>
    <button class="nav-btn" onclick={() => go(1)} aria-label="次の年">›</button>
  </div>

  {#if loading}
    <p class="state">集計中…</p>
  {:else}
    <section class="card">
      <div class="card-label">えみ あとどれくらい働ける？</div>
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
      <div class="fy-kv"><span class="k">課税支給額（確定）</span><span class="v">{yen(taxableYtd)}</span></div>
      {#if estimateTotal > 0}
        <div class="fy-kv"><span class="k">見込み（未受給）</span><span class="v">{yen(estimateTotal)}</span></div>
        <div class="fy-kv"><span class="k">合計（確定＋見込み）</span><span class="v {base > cap ? 'neg' : ''}">{yen(base)} / {yen(cap)}</span></div>
      {:else}
        <div class="fy-kv"><span class="k">上限</span><span class="v">{yen(cap)}</span></div>
      {/if}
      <div class="fy-kv"><span class="k">総支給（交通費込み）</span><span class="v">{yen(grossYtd)}</span></div>
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
        <p class="fy-note">※通勤手当・総労働時間は、給与明細を取り込んだ月のぶんだけ合計しています（取り込んでいない月は含みません）。</p>
      {/if}
    </section>

    {#key shiftKey}
      <ShiftPlanner {year} {wage} {received} onestimate={(t) => (estimateTotal = t)} />
    {/key}

    <div class="day-head"><span>月別のえみ給料</span><span>空欄はタップで見込み入力</span></div>
    <ul class="tx-list">
      {#each MONTHS as m (m)}
        {@const actual = grossM[m - 1]}
        {@const est = estFor(m)}
        {@const manual = isManualEst(m)}
        <li class="tx-row {actual === 0 ? 'tap' : ''}" onclick={() => openEst(m)}>
          <div class="tx-main">
            <span class="tx-name">{m}月</span>
            <span class="tx-sub">
              {#if actual > 0}{actual > SHAHO_MONTH_LINE ? '⚠️ 月8.8万超' : 'OK'}{detM[m - 1].minutes != null ? ` · ${(detM[m - 1].minutes! / 60).toFixed(0)}時間` : ''}
              {:else if est > 0}{manual ? '見込み（手動）' : `見込み（シフト ${shiftHoursByPay[m - 1].toFixed(1).replace(/\.0$/, '')}h）`}
              {:else}＋ タップで見込み入力{/if}
            </span>
          </div>
          <span class="tx-amt {actual > SHAHO_MONTH_LINE ? 'neg' : ''} {actual === 0 && est > 0 ? 'est' : ''}">{actual ? yen(actual) : (est > 0 ? yen(est) : '−')}</span>
        </li>
        {#if estM === m}
          <li class="fy-estedit">
            <div class="fy-estrow">
              <label class="field"><span>時間</span><input type="number" min="0" inputmode="numeric" bind:value={estH} /></label>
              <label class="field"><span>分</span><input type="number" min="0" max="59" inputmode="numeric" bind:value={estMin} /></label>
              <div class="fy-estamt">{yen(estAmt)}<small>（×¥{wage.toLocaleString('ja-JP')}）</small></div>
            </div>
            <div class="fy-estactions">
              <button class="primary" onclick={() => saveEst(m)}>保存</button>
              {#if manual}<button class="link neg" onclick={() => clearEst(m)}>クリア</button>{/if}
              <button class="link" onclick={() => (estM = null)}>閉じる</button>
            </div>
          </li>
        {/if}
      {/each}
    </ul>

    <p class="hint">1〜12月の「えみ給料」を<strong>給料日</strong>で集計しています。上限（103万円）は<strong>交通費を除いた金額</strong>で判定します。給与明細を取り込むほど、通勤手当・総労働時間も正確になります（取り込んでいない月は総支給で代用）。「1ヶ月あたり」は <strong>今年の残り ÷ 残りの月数</strong> の目安です。</p>
    <p class="hint">⚠️ 社会保険の「壁」は別ものです。2026年9月までは〈週20時間以上 かつ 月8.8万円以上〉で加入。<strong>2026年10月からは金額の条件がなくなり、〈週20時間以上〉だけ</strong>で加入対象になります。週の労働時間が20時間に近づいたら注意してください。（時給・上限は設定タブで変更できます）</p>
  {/if}
</div>
