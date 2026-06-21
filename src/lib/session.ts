import { writable } from 'svelte/store'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export const session = writable<Session | null>(null)
export const sessionReady = writable(false)

supabase.auth.getSession().then(({ data }) => {
  session.set(data.session)
  sessionReady.set(true)
})

supabase.auth.onAuthStateChange((_event, s) => {
  session.set(s)
})
