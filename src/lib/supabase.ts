import { createClient } from '@supabase/supabase-js'

// 公開鍵とURL。ローカルでは .env を使い、無ければ下のフォールバックを使う。
// publishable key は公開して問題ない鍵で、データは RLS（本人のみ）で保護される。
const FALLBACK_URL = 'https://hmmgvqoemblxqqivspvl.supabase.co'
const FALLBACK_KEY = 'sb_publishable_UoFnmx9CLJQvjnGSOQytSw_ydGjR-Rb'

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY

export const supabase = createClient(url, anonKey)
