import { supabase } from './supabase'
import type { Division } from './types'

const ACCOUNTS: { name: string; type: string }[] = [
  { name: '現金', type: 'cash' },
  { name: '銀行', type: 'bank' },
  { name: 'クレジットカード', type: 'credit' },
]

const CATEGORIES: { name: string; division: Division }[] = [
  { name: 'ゆうき給料', division: 'income' },
  { name: 'ボーナス', division: 'income' },
  { name: 'えみ給料', division: 'income' },
  { name: '所得税', division: 'tax' },
  { name: '住民税', division: 'tax' },
  { name: '健康保険', division: 'tax' },
  { name: '厚生年金', division: 'tax' },
  { name: '雇用保険', division: 'tax' },
  { name: '防衛費', division: 'saving' },
  { name: '特別費', division: 'saving' },
  { name: 'ゆうき貯金', division: 'saving' },
  { name: 'えみ貯金', division: 'saving' },
  { name: '家賃+駐車場代', division: 'fixed' },
  { name: '水道代', division: 'fixed' },
  { name: '電気代', division: 'fixed' },
  { name: '浄水器代', division: 'fixed' },
  { name: 'Wi-Fi代', division: 'fixed' },
  { name: '携帯代', division: 'fixed' },
  { name: '生命保険', division: 'fixed' },
  { name: 'ジム代', division: 'fixed' },
  { name: '定期代・交通費', division: 'fixed' },
  { name: '食費', division: 'variable' },
  { name: '日用品代', division: 'variable' },
  { name: '交際費', division: 'variable' },
  { name: 'ゆうきおこづかい', division: 'variable' },
  { name: 'えみおこづかい', division: 'variable' },
]

// カテゴリが未登録のときだけ初期データを投入する（重複防止）
export async function ensureSeed(userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('categories')
    .select('id', { count: 'exact', head: true })
  if (error) { console.warn('seed check failed', error.message); return false }
  if ((count ?? 0) > 0) return false

  const accRows = ACCOUNTS.map((a, i) => ({ ...a, user_id: userId, sort_order: i }))
  const catRows = CATEGORIES.map((c, i) => ({ ...c, user_id: userId, sort_order: i }))
  const r1 = await supabase.from('accounts').insert(accRows)
  const r2 = await supabase.from('categories').insert(catRows)
  if (r1.error) console.warn('seed accounts failed', r1.error.message)
  if (r2.error) console.warn('seed categories failed', r2.error.message)
  return !r1.error && !r2.error
}
