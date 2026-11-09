import { describe, it, expect } from 'vitest'
import {
  monthKey, shiftKey, keyDiff, keyRange, periodOfDate, periodRange, dueDateIn,
  bigPayKey, bigStartKey, netIncomes, computeMonths, summarizeBigs, yearRows, up1000, carryStartKey,
  type PlanInput, type PlanRule, type BigPayment,
} from './allocation'

const S = 25

describe('月（YYYY-MM）', () => {
  it('ずらす・差・並び', () => {
    expect(shiftKey('2026-12', 1)).toBe('2027-01')
    expect(shiftKey('2026-01', -1)).toBe('2025-12')
    expect(keyDiff('2026-10', '2027-03')).toBe(5)
    expect(keyRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(monthKey(2026, 3)).toBe('2026-03')
  })
  it('日付がどの月に入るか（25日始まり）', () => {
    expect(periodOfDate('2026-11-25', S)).toBe('2026-11')
    expect(periodOfDate('2026-11-24', S)).toBe('2026-10')
    expect(periodOfDate('2026-01-10', S)).toBe('2025-12')
  })
  it('月の最初と最後の日', () => {
    expect(periodRange('2026-11', S)).toEqual({ start: '2026-11-25', end: '2026-12-24' })
  })
})

describe('日付（休日の扱い）', () => {
  it('支払いは翌営業日・月をまたぐ日は次の暦月', () => {
    // 2026-12-27 は日曜 → 28日（月）
    expect(dueDateIn('2026-12', 27, S, 'out')).toEqual({ date: '2026-12-28', moved: true })
    // 1日払いの家賃は翌月1日。2026-11-01 は日曜 → 2日
    expect(dueDateIn('2026-10', 1, S, 'out')).toEqual({ date: '2026-11-02', moved: true })
  })
  it('25日の給料は前の営業日、月末払いは翌営業日', () => {
    // 2026-10-25 は日曜 → 23日（金）
    expect(dueDateIn('2026-10', 25, S, 'in').date).toBe('2026-10-23')
    // 31日払い：2026-10-31 は土曜 → 11-02（月）
    expect(dueDateIn('2026-10', 31, S, 'in').date).toBe('2026-11-02')
    // 30日しかない月は月末に寄せる
    expect(dueDateIn('2026-11', 31, S, 'in').date).toBe('2026-11-30')
  })
})

describe('給与明細から手取り', () => {
  const name = (c: string | null) => c ?? '還付'
  it('収入 − 控除。同じ日の給料とボーナスは控除を額の比で分ける', () => {
    const r = netIncomes([
      { date: '2026-03-25', type: 'income', amount: 300000, category_id: 'sal', person: 'ゆうき', source: 'ocr' },
      { date: '2026-03-25', type: 'income', amount: 100000, category_id: 'bonus', person: 'ゆうき', source: 'ocr' },
      { date: '2026-03-25', type: 'expense', amount: 40000, category_id: 'tax', person: 'ゆうき', source: 'ocr' },
      { date: '2026-03-31', type: 'income', amount: 90000, category_id: 'emi', person: 'えみ', source: 'ocr' },
      { date: '2026-03-31', type: 'income', amount: 5000, category_id: 'food', person: 'えみ', source: 'manual' },
    ], S, name)
    const by = Object.fromEntries(r.map(x => [x.category_id, x]))
    expect(by.sal.amount).toBe(270000)
    expect(by.bonus.amount).toBe(90000)
    expect(by.sal.period_month).toBe('2026-03')
    expect(by.emi.amount).toBe(90000)
    expect(by.food).toBeUndefined()
  })
})

const rule = (p: Partial<PlanRule> & { id: string }): PlanRule => ({
  name: p.id, direction: 'out', amount: 0, due_day: null, account_id: null, category_id: null, active: true, sort_order: 0, ...p,
})
const big = (p: Partial<BigPayment> & { id: string }): BigPayment => ({
  name: p.id, year: 2027, planned_month: 3, due_day: 15, budget_amount: 120000, actual_amount: null,
  is_reserved: true, monthly_amount: null, saved_opening: 0, account_id: null, created_at: '2026-11-26T00:00:00Z', ...p,
})
const base = (p: Partial<PlanInput> = {}): PlanInput => ({
  startDay: S, today: '2026-11-09', rules: [], bigs: [], lines: [], funds: [], incomeActuals: [],
  accounts: [{ id: 'rk', name: '楽天銀行', role: 'salary' }, { id: 'yu', name: 'ゆうちょ', role: 'normal' }, { id: 'sbi', name: 'SBI', role: 'savings' }],
  ...p,
})

describe('大きな支払い', () => {
  it('払う月と積立を始める月', () => {
    expect(bigPayKey(big({ id: 'a' }), S)).toBe('2027-02')              // 3/15 は 2/25 の給料の月
    expect(bigStartKey(big({ id: 'a' }), S)).toBe('2026-11')
    expect(bigStartKey(big({ id: 'a', created_at: undefined }), S)).toBe('2026-03')
  })
  it('毎月の積立は 残り÷回数（千円単位で切り上げ）、割り当てると次の月の額が変わる', () => {
    const b = big({ id: 'shaken' })                                          // 11月〜2月の4回、12万
    const inp = base({ bigs: [b] })
    const m = computeMonths(inp, '2026-11', '2027-02')
    expect(m.map(x => x.bigs[0]?.need)).toEqual([30000, 30000, 30000, 30000])
    // 11月に 50,000 割り当てると、残り 70,000 を3回 → 24,000
    const inp2 = base({ bigs: [b], lines: [{ period_month: '2026-11', kind: 'big', payment_id: null, special_id: 'shaken', planned: null, actual: null, allocated: 50000 }] })
    const m2 = computeMonths(inp2, '2026-11', '2027-02')
    expect(m2[1].bigs[0].need).toBe(up1000(70000 / 3))
    expect(m2[3].payBigs[0].enough).toBe(true)
  })
  it('過去の月で割り当てなかった分は積立済みに数えない', () => {
    const b = big({ id: 'p', created_at: '2026-06-26T00:00:00Z', budget_amount: 60000, year: 2026, planned_month: 12, due_day: 1 })
    // 今日 11/9 → 今の月は 2026-10。6月〜9月は割り当てなし、8月だけ 5,000 割り当て
    const inp = base({ bigs: [b], lines: [{ period_month: '2026-08', kind: 'big', payment_id: null, special_id: 'p', planned: null, actual: null, allocated: 5000 }] })
    const s = summarizeBigs(inp, '2026-10')[0]
    expect(s.saved).toBe(5000)
    expect(s.rest).toBe(55000)
    expect(s.times).toBe(2)                                                   // 10月・11月
    expect(s.monthly).toBe(up1000(55000 / 2))
  })
  it('初期値・口座から当てた額・手入力の毎月額', () => {
    const b = big({ id: 'x', saved_opening: 40000, monthly_amount: 10000 })
    const inp = base({ bigs: [b], funds: [{ period_month: '2026-12', account_id: 'sbi', special_id: 'x', amount: 20000 }] })
    const m = computeMonths(inp, '2026-11', '2027-02')
    expect(m.map(x => x.bigs[0].need)).toEqual([10000, 10000, 10000, 10000])
    expect(m[3].payBigs[0].projected).toBe(40000 + 20000 + 40000)
    expect(m[3].payBigs[0].enough).toBe(false)
    const s = summarizeBigs(inp, '2027-01')[0]
    expect(s.saved).toBe(40000 + 10000 + 20000 + 10000)
    expect(s.times).toBe(2)
  })
})

describe('1か月の計算と繰り越し', () => {
  const rules = [
    rule({ id: 'sal', name: 'ゆうき給料', direction: 'in', amount: 260000, due_day: 25, account_id: 'rk', category_id: 'c_sal' }),
    rule({ id: 'rent', name: '家賃', amount: 75920, due_day: 1, account_id: 'yu' }),
    rule({ id: 'card', name: '楽天カード', amount: 180000, due_day: 27, account_id: 'rk' }),
    rule({ id: 'food', name: '食費', amount: 20000 }),                       // 予算だけ
  ]
  it('割り当て・状態・まだ割り当てていないお金・移す額', () => {
    const inp = base({
      rules,
      incomeActuals: [{ period_month: '2026-10', category_id: 'c_sal', name: 'ゆうき給料', amount: 261000 }],
      lines: [
        { period_month: '2026-10', kind: 'payment', payment_id: 'rent', special_id: null, planned: null, actual: 75920, allocated: 75920 },
        { period_month: '2026-10', kind: 'payment', payment_id: 'card', special_id: null, planned: null, actual: 188400, allocated: 180000 },
      ],
    })
    const [m] = computeMonths(inp, '2026-10', '2026-10')
    expect(m.incomeSum).toBe(261000)                                          // 明細の手取りが予定より優先
    expect(m.sources).toBe(261000)
    const by = Object.fromEntries(m.payments.map(p => [p.rule.id, p]))
    expect(by.rent.status).toBe('paid')                                       // 11/2 引落・今日 11/9
    expect(by.card.status).toBe('over')                                       // 実際が 8,400 多い
    expect(by.card.diff).toBe(8400)
    expect(by.food.status).toBe('unallocated')
    expect(by.food.date).toBeNull()
    expect(m.allocSum).toBe(255920)
    expect(m.free).toBe(261000 - 255920)
    expect(m.restCount).toBe(1)
    expect(m.diffCount).toBe(1)
    expect(m.diffSum).toBe(8400)
    // 給料の口座（楽天）に落ちるカードは移さない。家賃はゆうちょへ
    expect(m.moves).toEqual([{ accountId: 'yu', amount: 75920, names: ['家賃'] }])
    // 予定と実際の差は自動で動かさない：繰り越しは割り当ての額で計算
    expect(m.carryOut).toBe(261000 - 255920 - 20000)
  })
  it('繰り越しが次の月の使えるお金に入る・口座から足した額', () => {
    const inp = base({ rules, funds: [{ period_month: '2026-11', account_id: 'sbi', special_id: null, amount: 50000 }] })
    const m = computeMonths(inp, '2026-10', '2026-11')
    const need = 75920 + 180000 + 20000
    expect(m[0].carryOut).toBe(260000 - need)
    expect(m[1].carryIn).toBe(260000 - need)
    expect(m[1].fundIn).toBe(50000)
    expect(m[1].sources).toBe(260000 + (260000 - need) + 50000)
  })
  it('決まりの無い収入（ボーナス）は明細があれば足す・止めた決まりは出さない', () => {
    const inp = base({
      rules: [...rules, rule({ id: 'old', name: '止めた', amount: 999, due_day: 10, active: false })],
      incomeActuals: [{ period_month: '2027-03', category_id: 'c_bonus', name: 'ボーナス', amount: 411480 }],
    })
    const [m] = computeMonths(inp, '2027-03', '2027-03')
    expect(m.incomes.map(i => i.name)).toEqual(['ゆうき給料', 'ボーナス'])
    expect(m.payments.find(p => p.rule.id === 'old')).toBeUndefined()
  })
  it('繰り越しは割り当てを始めた月から（それより前の未割り当ては借りにしない）', () => {
    const inp = base({ rules, lines: [{ period_month: '2026-11', kind: 'payment', payment_id: 'rent', special_id: null, planned: null, actual: null, allocated: 75920 }] })
    expect(carryStartKey(inp, '2026-10')).toBe('2026-11')
    expect(carryStartKey(base({ rules }), '2026-10')).toBe('2026-10')
    const m = computeMonths(inp, '2026-08', '2026-12', carryStartKey(inp, '2026-10'))
    expect(m.map(x => x.carryIn)).toEqual([0, 0, 0, 0, m[3].sources - m[3].allocSum - m[3].rest])
  })
  it('年ごとのまとめ', () => {
    const m = computeMonths(base({ rules }), '2026-11', '2027-02')
    const y = yearRows(m, 2027)
    expect(y.map(r => r.key)).toEqual(['2027-01', '2027-02'])
    expect(y[0].diff).toBe(260000 - (75920 + 180000 + 20000))
  })
})
