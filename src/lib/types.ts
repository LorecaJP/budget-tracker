// DBの型定義（schema_supabase.sql と対応。将来 SwiftData の @Model にも対応する形）
import type { AccountRole, Direction } from './plan/allocation'
export type AccountType = 'cash' | 'bank' | 'credit' | 'emoney'
export type Division = 'income' | 'tax' | 'saving' | 'fixed' | 'variable'
export type TxType = 'expense' | 'income' | 'transfer'
export type TxSource = 'manual' | 'recurring' | 'csv' | 'ocr'
export type ScheduledStatus = 'planned' | 'confirmed' | 'paid'   // 予定 / 確定 / 支払済
// 作り替え§12（割り当て）の型は src/lib/plan/allocation.ts にまとめてある
export type { AccountRole, Direction, Repeat, PlanLine, FundUse, PlanRule, BigPayment } from './plan/allocation'

export interface Account {
  id: string
  name: string
  type: AccountType
  opening_balance: number
  color: string | null
  sort_order: number
  archived: boolean
  monthly_alloc?: number | null   // 毎月この口座へ振り分ける計画額（配分プラン・任意。列未追加なら undefined）
  role?: AccountRole | null       // 作り替え§12：normal / salary＝給料の受け取り / savings＝割り当てに使える貯金（plan.sql。未適用なら undefined）
  balance?: number | null         // 残高（手入力）
  balance_date?: string | null    // 残高を入れた日
}

export interface Category {
  id: string
  name: string
  division: Division
  parent_id: string | null
  color: string | null
  icon: string | null
  sort_order: number
  archived: boolean
  goal_amount?: number | null   // 貯金の目標額（貯蓄カテゴリ用・任意。列未追加なら undefined）
}

export interface Transaction {
  id: string
  date: string            // 'YYYY-MM-DD'
  amount: number          // 円・整数・正の値
  type: TxType
  category_id: string | null
  account_id: string | null
  to_account_id: string | null
  person: string | null   // 'ゆうき' / 'えみ' / null
  memo: string
  source: TxSource
  needs_review: boolean
  created_at: string
}

export interface ScheduledPayment {
  id: string
  name: string
  amount: number          // 確定額・円・整数
  due_date: string | null // 'YYYY-MM-DD' 引落日（単発のとき）
  due_day: number | null  // 毎月くりかえしの引落日（1-28。plan.sql 適用後は 1-31。休日は翌営業日に補正して表示）
  account_id: string | null   // 引落口座
  category_id: string | null
  status: ScheduledStatus
  memo: string
  // 作り替え§12（plan.sql で追加。未適用なら undefined＝out / 0 / true とみなす）
  direction?: Direction   // out=支払い / in=収入
  card_source?: 'rakuten' | null   // 作り替え④：楽天カードの請求の合計を実際の額に（plan.sql 10）。未適用なら undefined
  sort_order?: number
  active?: boolean
}

// 楽天カード明細（家計簿本体とは別管理の分析用テーブル）
export interface RakutenTx {
  id: string
  use_date: string          // 'YYYY-MM-DD'
  merchant: string
  amount: number
  person: string            // '本人' / '家族'
  category: string
  statement_month: string   // 'YYYY-MM'（請求月）
}

export const DIVISION_LABELS: Record<Division, string> = {
  income: '収入',
  tax: '税金・社保',
  saving: '貯蓄',
  fixed: '固定費',
  variable: '変動費',
}
