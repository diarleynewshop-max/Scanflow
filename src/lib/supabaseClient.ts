import { createClient } from '@supabase/supabase-js';

// Cliente Supabase (banco na VPS: https://db.newgrup.cloud).
// A anon key e publica por design (protegida por RLS no banco). NUNCA usar a
// service_role no frontend.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Nao derruba o app: telas que ainda nao usam Supabase seguem funcionando.
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY nao configurados.');
}

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: false },
});
