import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  // Fail fast to avoid silent auth issues
  // eslint-disable-next-line no-console
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables.')
}

export const supabase = createClient(
  supabaseUrl || 'https://missing-supabase-url.invalid',
  supabaseAnonKey || 'missing-supabase-anon-key',
  {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  }
)
