// DBの型定義（schema_supabase.sql と対応。将来 SwiftData の @Model にも対応する形）
export type AccountType = 'cash' | 'bank' | 'credit' | 'emoney'
export type Division = 'income' | 'tax' | 'saving' | 'fixed' | 'variable'
export type TxType = 'expense' | 'income' | 'transfer'
export type TxSource = 'manual' | 'recurring' | 'csv' | 'ocr'
export type ScheduledStatus = 'planned' | 'confirmed' | 'paid'   // 予定 / 確定 / 支払済

export interface Account {
  id: string
  name: string
  type: AccountType
  opening_balance: number
  color: string | null
  sort_order: number
  archived: boolean
  monthly_alloc?: number | null   // 毎月この口座へ振り分ける計画額（配分プラン・任意。列未追加なら undefined）
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
  due_date: string        // 'YYYY-MM-DD' 引落日
  account_id: string | null   // 引落口座
  category_id: string | null
  status: ScheduledStatus
  memo: string
}

export const DIVISION_LABELS: Record<Division, string> = {
  income: '収入',
  tax: '税金・社保',
  saving: '貯蓄',
  fixed: '固定費',
  variable: '変動費',
}
