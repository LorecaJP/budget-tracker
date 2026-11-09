// 作り替え（CLAUDE.md §12）：その月の「使えるお金」を項目ごとに割り当てる仕組みの計算。
// UI・DBから切り離した純粋関数だけを置く（単体テスト：allocation.test.ts）。
//
// 用語
//   月（period）  : 'YYYY-MM'。startDay（既定25）日の給料で、その日〜翌月 startDay-1 日に落ちる支払いを払う区切り。
//   決まり（rule）: 毎月の項目（scheduled_payments）。支払い(out)か収入(in)。日付なし＝予算だけ。
//   大きな支払い  : special_expenses。払う月までの各月に積立を割り当てる。
//   行（line）    : plan_lines。月×項目の 予定(planned)・実際(actual)・割り当て(allocated)。空は「決まりの額」「まだ」「未割り当て」。
import { isBusinessDay } from '../businessday'

// ---------- 入力の型（DBの行と同じ形。types.ts からも使う） ----------
export type Direction = 'out' | 'in'
export type Repeat = 'once' | 'yearly' | 'every2y'
export type AccountRole = 'normal' | 'salary' | 'savings'

export interface PlanRule {
  id: string
  name: string
  direction: Direction
  amount: number                 // ふだんの額（円）
  due_day: number | null         // 毎月の日（1-31）。null かつ due_date も null なら「予算だけ」
  due_date?: string | null       // 単発（'YYYY-MM-DD'）。新しい画面ではその月だけに出す
  account_id: string | null
  category_id: string | null
  active?: boolean
  sort_order?: number
}

export interface BigPayment {
  id: string
  name: string
  year: number
  planned_month: number          // 1-12
  due_day: number | null         // null＝日にち未定（その月の1日として扱う）
  budget_amount: number          // 金額
  actual_amount: number | null
  is_reserved: boolean           // 積立の対象か
  monthly_amount: number | null  // 毎月の積立額の手入力（null＝自動）
  saved_opening: number          // 新しい仕組みの前に貯まっていた額
  account_id: string | null
  created_at?: string            // 積立を始める月の目安（無ければ払う月の12か月前から）
}

export interface PlanLine {
  id?: string
  period_month: string
  kind: 'payment' | 'big'
  payment_id: string | null
  special_id: string | null
  planned: number | null
  actual: number | null
  allocated: number | null
  memo?: string
}

export interface FundUse {
  id?: string
  period_month: string
  account_id: string | null
  special_id: string | null      // null＝その月の使えるお金に足す
  amount: number
}

export interface AccountLite { id: string; name: string; role?: AccountRole | null }

// 収入の実際（給与明細から出した手取り）。category_id ごと・月ごと
export interface IncomeActual { period_month: string; category_id: string | null; name: string; amount: number }

// ---------- 月（'YYYY-MM'） ----------
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}
export function parseKey(key: string): { y: number; m: number } {
  return { y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) }
}
export function shiftKey(key: string, delta: number): string {
  const { y, m } = parseKey(key)
  const idx = y * 12 + (m - 1) + delta
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1)
}
export function keyDiff(a: string, b: string): number {   // b − a（月数）
  const A = parseKey(a), B = parseKey(b)
  return (B.y * 12 + B.m) - (A.y * 12 + A.m)
}
export function keyRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let k = from; keyDiff(k, to) >= 0; k = shiftKey(k, 1)) out.push(k)
  return out
}
// 'YYYY-MM-DD' がどの月に入るか（文字列だけで計算＝タイムゾーンに依存しない）
export function periodOfDate(iso: string, startDay: number): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10))
  return d >= startDay ? monthKey(y, m) : shiftKey(monthKey(y, m), -1)
}
// その月の最初と最後の日
export function periodRange(key: string, startDay: number): { start: string; end: string } {
  const { y, m } = parseKey(key)
  const n = parseKey(shiftKey(key, 1))
  const endDay = startDay - 1
  const end = endDay >= 1 ? isoOf(n.y, n.m, Math.min(endDay, daysIn(n.y, n.m))) : isoOf(y, m, daysIn(y, m))
  return { start: isoOf(y, m, Math.min(startDay, daysIn(y, m))), end }
}

function daysIn(y: number, m: number): number { return new Date(y, m, 0).getDate() }
function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function fromIso(iso: string): Date { return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) }
function toIso(d: Date): string { return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()) }

// ---------- 日付 ----------
// 月 key の中で、毎月 day 日に当たる日（休日の扱いつき）。
//   支払い(out)：土日祝なら翌営業日。
//   収入(in)  ：土日祝なら前の営業日（25日の給料の前倒し）。ただし28日以降（月末払い）は翌営業日。
// ※どの月に入るかは「決まりの日」で決める（ずらした日では決めない＝25日が日曜で23日に入っても同じ月）。
export function dueDateIn(key: string, day: number, startDay: number, direction: Direction = 'out'): { date: string; moved: boolean } {
  const { y, m } = parseKey(key)
  const n = parseKey(shiftKey(key, 1))
  const [yy, mm] = day >= startDay ? [y, m] : [n.y, n.m]
  const d = fromIso(isoOf(yy, mm, Math.min(day, daysIn(yy, mm))))
  const step = direction === 'in' && day < 28 ? -1 : 1
  let moved = false
  while (!isBusinessDay(d)) { d.setDate(d.getDate() + step); moved = true }
  return { date: toIso(d), moved }
}

// 大きな支払いを払う日（日にち未定は1日）と、その月 key
export function bigDate(b: BigPayment): string {
  return isoOf(b.year, b.planned_month, Math.min(b.due_day ?? 1, daysIn(b.year, b.planned_month)))
}
export function bigPayKey(b: BigPayment, startDay: number): string {
  return periodOfDate(bigDate(b), startDay)
}
// 積立を始める月：作った月（無ければ払う月の11か月前）。払う月より後にはしない
export function bigStartKey(b: BigPayment, startDay: number): string {
  const pay = bigPayKey(b, startDay)
  const start = b.created_at ? periodOfDate(b.created_at.slice(0, 10), startDay) : shiftKey(pay, -11)
  return keyDiff(start, pay) >= 0 ? start : pay
}

export function up1000(n: number): number { return Math.ceil(n / 1000) * 1000 }

// ---------- 収入：給与明細（取引）から手取りを出す ----------
// source='ocr' の取引を「日付×人」でまとめ、収入 − 控除（支出）＝手取り。
// 同じ日に給料とボーナスがあるときは、控除を収入の額の比で分ける（端数は一番大きい収入へ）。
export interface TxLite { date: string; type: string; amount: number; category_id: string | null; person: string | null; source: string }
export function netIncomes(txs: TxLite[], startDay: number, nameOf: (categoryId: string | null) => string): IncomeActual[] {
  const groups = new Map<string, { inc: Map<string | null, number>; ded: number; date: string }>()
  for (const t of txs) {
    if (t.source !== 'ocr' || t.type === 'transfer') continue
    const g = groups.get(`${t.date}|${t.person ?? ''}`) ?? { inc: new Map(), ded: 0, date: t.date }
    if (t.type === 'income') g.inc.set(t.category_id, (g.inc.get(t.category_id) ?? 0) + t.amount)
    else g.ded += t.amount
    groups.set(`${t.date}|${t.person ?? ''}`, g)
  }
  const sum = new Map<string, IncomeActual>()
  for (const g of groups.values()) {
    const total = [...g.inc.values()].reduce((a, b) => a + b, 0)
    if (total <= 0) continue
    const entries = [...g.inc.entries()].sort((a, b) => b[1] - a[1])
    let left = g.ded
    entries.forEach(([cat, amt], i) => {
      const share = i === entries.length - 1 ? left : Math.round(g.ded * amt / total)
      left -= share
      const key = periodOfDate(g.date, startDay)
      const k = `${key}|${cat ?? ''}`
      const cur = sum.get(k) ?? { period_month: key, category_id: cat, name: nameOf(cat), amount: 0 }
      cur.amount += amt - share
      sum.set(k, cur)
    })
  }
  return [...sum.values()]
}

// ---------- 1か月の計算 ----------
export type RowStatus = 'unallocated' | 'ready' | 'short' | 'paid' | 'over' | 'under'
// unallocated=未割り当て / ready=用意済み / short=あと少し / paid=支払い済み / over=実際が多かった（不足） / under=実際が少なかった（余り）

export interface PaymentRow {
  rule: PlanRule
  date: string | null            // null＝予算だけ
  moved: boolean                 // 休日でずらした
  planned: number                // その月の予定（行の planned か決まりの額）
  actual: number | null
  need: number                   // 必要な額（実際があれば実際）
  allocated: number | null
  status: RowStatus
  diff: number                   // 実際 − 割り当て（支払い済みで差があるとき）
}
export interface BigRow {
  big: BigPayment
  need: number                   // この月の積立の必要額（手入力・行の予定・自動）
  allocated: number | null
  status: RowStatus
  remainingTimes: number         // この月を含めて払う月まであと何回
}
export interface PayBigRow { big: BigPayment; date: string; projected: number; enough: boolean }
export interface IncomeRow { rule: PlanRule | null; name: string; date: string | null; planned: number; actual: number | null; amount: number }
export interface Move { accountId: string | null; amount: number; names: string[] }

export interface MonthResult {
  key: string
  range: { start: string; end: string }
  incomes: IncomeRow[]
  incomeSum: number
  carryIn: number
  fundIn: number                 // 口座から使えるお金に足した額
  sources: number                // 使えるお金＝収入＋繰り越し＋口座から
  payments: PaymentRow[]
  bigs: BigRow[]
  payBigs: PayBigRow[]
  allocSum: number
  needSum: number
  rest: number                   // 未割り当ての必要額
  restCount: number
  diffCount: number
  diffSum: number                // 実際 − 割り当て の合計（＋は不足）
  free: number                   // まだ割り当てていないお金
  carryOut: number               // 次の月へ（割り当て済みは割り当て、未割り当ては必要額を使ったとみなす）
  moves: Move[]                  // 給料の口座から移す額（口座ごと）
}

export interface PlanInput {
  startDay: number
  today: string                  // 'YYYY-MM-DD'
  rules: PlanRule[]
  bigs: BigPayment[]
  lines: PlanLine[]
  funds: FundUse[]
  incomeActuals: IncomeActual[]
  accounts: AccountLite[]
}

function lineOf(lines: PlanLine[], key: string, kind: 'payment' | 'big', id: string): PlanLine | undefined {
  return lines.find(l => l.period_month === key && l.kind === kind && (kind === 'payment' ? l.payment_id === id : l.special_id === id))
}

function statusOf(need: number, allocated: number | null, actual: number | null, paid: boolean): RowStatus {
  if (allocated == null) return 'unallocated'
  if (paid && actual != null) return actual > allocated ? 'over' : actual < allocated ? 'under' : 'paid'
  return allocated >= need ? 'ready' : 'short'
}

// 決まりがその月に出るか（単発は入る月だけ・止めたものは出さない）
function ruleInMonth(r: PlanRule, key: string, startDay: number): boolean {
  if (r.active === false) return false
  if (r.due_date) return periodOfDate(r.due_date, startDay) === key
  return true
}

// 大きな支払い：各月の積立の必要額と、月の頭の積立済みを、作った月から順に出す
export interface BigTrack { need: Map<string, number>; savedBefore: Map<string, number>; payKey: string; startKey: string }
export function trackBig(b: BigPayment, inp: PlanInput): BigTrack {
  const payKey = bigPayKey(b, inp.startDay)
  const startKey = bigStartKey(b, inp.startDay)
  const need = new Map<string, number>(), savedBefore = new Map<string, number>()
  let saved = b.saved_opening ?? 0
  // 口座から当てた額（月ごと）
  const fundsBy = new Map<string, number>()
  for (const f of inp.funds) if (f.special_id === b.id) fundsBy.set(f.period_month, (fundsBy.get(f.period_month) ?? 0) + f.amount)
  // 作った月より前に当てた分も積立済みに入れる
  for (const [k, v] of fundsBy) if (keyDiff(k, startKey) > 0) saved += v
  if (!b.is_reserved) return { need, savedBefore, payKey, startKey }
  for (const k of keyRange(startKey, payKey)) {
    saved += fundsBy.get(k) ?? 0
    savedBefore.set(k, saved)
    const times = keyDiff(k, payKey) + 1
    const line = lineOf(inp.lines, k, 'big', b.id)
    const auto = Math.max(0, up1000((b.budget_amount - saved) / times))
    const n = line?.planned ?? b.monthly_amount ?? auto
    need.set(k, n)
    saved += line?.allocated ?? n
  }
  return { need, savedBefore, payKey, startKey }
}

// 月の並び（from〜to）を、繰り越しをつなげて計算する。
// 繰り越しは carryFrom の月から始める（それより前の月は繰り越し 0・次へも渡さない）。
// 割り当てを始める前の過去の月は「割り当てなかった必要額」を借りとして積み上げてしまうため、
// 呼び出し側は「割り当て（plan_lines / fund_uses）がある一番古い月、無ければ今の月」を渡す。
export function carryStartKey(inp: PlanInput, currentKey: string): string {
  const keys = [...inp.lines.map(l => l.period_month), ...inp.funds.map(f => f.period_month)]
  return keys.length ? keys.reduce((a, b) => (keyDiff(a, b) < 0 ? b : a)) : currentKey
}
export function computeMonths(inp: PlanInput, from: string, to: string, carryFrom: string = from): MonthResult[] {
  const { startDay } = inp
  const salaryAcc = inp.accounts.find(a => a.role === 'salary')?.id ?? null
  const tracks = new Map<string, BigTrack>()
  for (const b of inp.bigs) tracks.set(b.id, trackBig(b, inp))
  const out: MonthResult[] = []
  let carry = 0
  for (const key of keyRange(from, to)) {
    if (keyDiff(key, carryFrom) >= 0) carry = 0   // 繰り越しを始める月まで（その月を含む）は 0 から
    // 収入：決まり(in)ごとに、明細の実際があれば実際
    const incomes: IncomeRow[] = []
    const used = new Set<string>()
    for (const r of inp.rules.filter(r => r.direction === 'in' && ruleInMonth(r, key, startDay))) {
      const acts = inp.incomeActuals.filter(a => a.period_month === key && a.category_id != null && a.category_id === r.category_id)
      acts.forEach(a => used.add(`${a.category_id}`))
      const actual = acts.length ? acts.reduce((s, a) => s + a.amount, 0) : null
      const line = lineOf(inp.lines, key, 'payment', r.id)
      const planned = line?.planned ?? r.amount
      const date = r.due_day ? dueDateIn(key, r.due_day, startDay, 'in').date : (r.due_date ?? null)
      incomes.push({ rule: r, name: r.name, date, planned, actual: line?.actual ?? actual, amount: line?.actual ?? actual ?? planned })
    }
    // 決まりの無い収入（ボーナスなど）は、明細があればそのまま足す
    for (const a of inp.incomeActuals.filter(a => a.period_month === key && !used.has(`${a.category_id}`))) {
      incomes.push({ rule: null, name: a.name, date: null, planned: 0, actual: a.amount, amount: a.amount })
    }
    const incomeSum = incomes.reduce((s, x) => s + x.amount, 0)
    const fundIn = inp.funds.filter(f => f.period_month === key && !f.special_id).reduce((s, f) => s + f.amount, 0)
    const sources = incomeSum + carry + fundIn

    // 毎月の支出
    const payments: PaymentRow[] = inp.rules
      .filter(r => r.direction === 'out' && ruleInMonth(r, key, startDay))
      .map(r => {
        const line = lineOf(inp.lines, key, 'payment', r.id)
        const d = r.due_day ? dueDateIn(key, r.due_day, startDay, 'out') : r.due_date ? { date: r.due_date, moved: false } : null
        const planned = line?.planned ?? r.amount
        const actual = line?.actual ?? null
        const need = actual ?? planned
        const allocated = line?.allocated ?? null
        const paid = d != null && d.date <= inp.today
        const status = statusOf(need, allocated, actual, paid)
        return { rule: r, date: d?.date ?? null, moved: d?.moved ?? false, planned, actual, need, allocated, status, diff: allocated != null && actual != null ? actual - allocated : 0 }
      })
      .sort((a, b) => (a.date ?? '9999') < (b.date ?? '9999') ? -1 : (a.date ?? '9999') > (b.date ?? '9999') ? 1 : (a.rule.sort_order ?? 0) - (b.rule.sort_order ?? 0))

    // 大きな支払いの積立と、この月に払うもの
    const bigs: BigRow[] = []
    const payBigs: PayBigRow[] = []
    for (const b of inp.bigs) {
      const t = tracks.get(b.id)!
      const need = t.need.get(key)
      if (need != null && (need > 0 || lineOf(inp.lines, key, 'big', b.id)?.allocated != null)) {
        const allocated = lineOf(inp.lines, key, 'big', b.id)?.allocated ?? null
        bigs.push({ big: b, need, allocated, status: statusOf(need, allocated, null, false), remainingTimes: keyDiff(key, t.payKey) + 1 })
      }
      if (t.payKey === key) {
        const before = t.savedBefore.get(key) ?? (b.saved_opening ?? 0)
        const lineAlloc = lineOf(inp.lines, key, 'big', b.id)?.allocated
        const projected = before + (lineAlloc ?? t.need.get(key) ?? 0)
        payBigs.push({ big: b, date: bigDate(b), projected, enough: projected >= b.budget_amount })
      }
    }

    let allocSum = 0, needSum = 0, rest = 0, restCount = 0, eff = 0, diffCount = 0, diffSum = 0
    for (const r of [...payments, ...bigs]) {
      needSum += r.need
      if (r.allocated != null) { allocSum += r.allocated; eff += r.allocated } else { rest += r.need; restCount++; eff += r.need }
    }
    for (const p of payments) if (p.allocated != null && p.actual != null && p.actual !== p.allocated) { diffCount++; diffSum += p.actual - p.allocated }

    // 給料の口座から移す額（口座ごと）
    const mv = new Map<string | null, Move>()
    const add = (acc: string | null, amt: number, name: string) => {
      if (acc === salaryAcc) return
      const m = mv.get(acc) ?? { accountId: acc, amount: 0, names: [] }
      m.amount += amt; if (!m.names.includes(name)) m.names.push(name)
      mv.set(acc, m)
    }
    for (const p of payments) if (p.allocated != null && p.rule.account_id) add(p.rule.account_id, p.allocated, p.rule.name)
    const savingsAcc = inp.accounts.find(a => a.role === 'savings')?.id ?? null
    for (const b of bigs) if (b.allocated != null) add(b.big.account_id ?? savingsAcc, b.allocated, '大きな支払いの積立')

    out.push({
      key, range: periodRange(key, startDay), incomes, incomeSum, carryIn: carry, fundIn, sources,
      payments, bigs, payBigs, allocSum, needSum, rest, restCount, diffCount, diffSum,
      free: sources - allocSum, carryOut: sources - eff, moves: [...mv.values()].filter(m => m.amount > 0),
    })
    carry = sources - eff
  }
  return out
}

// ---------- 大きな支払いの一覧（項目ごとの積立済み・あと） ----------
export interface BigSummary { big: BigPayment; date: string; payKey: string; saved: number; rest: number; monthly: number; times: number }
export function summarizeBigs(inp: PlanInput, currentKey: string): BigSummary[] {
  return inp.bigs.map(b => {
    const t = trackBig(b, inp)
    // 積立済み＝今の月の頭までに積み立てた額（初期値＋口座から＋前の月までの割り当て）
    const from = keyDiff(t.startKey, currentKey) >= 0 ? currentKey : t.startKey   // 今の月と始めた月の遅い方
    let saved: number
    if (keyDiff(from, t.payKey) >= 0) saved = t.savedBefore.get(from) ?? (b.saved_opening ?? 0)
    else {                                                                        // 払う月を過ぎた
      const alloc = lineOf(inp.lines, t.payKey, 'big', b.id)?.allocated
      saved = (t.savedBefore.get(t.payKey) ?? (b.saved_opening ?? 0)) + (alloc ?? t.need.get(t.payKey) ?? 0)
    }
    const times = Math.max(0, keyDiff(from, t.payKey) + 1)
    return { big: b, date: bigDate(b), payKey: t.payKey, saved: Math.min(saved, b.budget_amount), rest: Math.max(0, b.budget_amount - saved), monthly: t.need.get(from) ?? 0, times }
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
}

// ---------- 年ごとのまとめ ----------
export interface YearRow { key: string; income: number; out: number; diff: number }
export function yearRows(months: MonthResult[], year: number): YearRow[] {
  return months.filter(m => parseKey(m.key).y === year).map(m => {
    const out = m.needSum
    return { key: m.key, income: m.incomeSum, out, diff: m.incomeSum - out }
  })
}
