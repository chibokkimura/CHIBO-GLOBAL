import { supabase } from './supabaseClient'

export async function signInWithGoogle() {
  const redirectTo = `${window.location.origin}/`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) throw error
}

export async function signInWithEmailPassword(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (error) throw error;
}

export async function signUpWithEmailPassword(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const redirectTo = `${window.location.origin}/`;
  const { error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw error
}
