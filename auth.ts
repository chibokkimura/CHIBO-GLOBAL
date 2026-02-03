import { supabase } from './supabaseClient'

export async function signInWithGoogle() {
  const redirectTo = `${window.location.origin}/`
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}
