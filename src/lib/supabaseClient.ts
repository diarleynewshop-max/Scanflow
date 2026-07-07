import { createClient } from '@supabase/supabase-js';

// Injetado em build-time pelo vite.config.ts a partir de SUPABASE_URL/
// SUPABASE_ANON_KEY (sem prefixo VITE_), quando essas sao as unicas vars
// disponiveis na Vercel (ex.: integracao nativa Vercel<->Supabase).
declare const __SUPABASE_URL_FALLBACK__: string;
declare const __SUPABASE_ANON_KEY_FALLBACK__: string;

// Cliente Supabase. A anon key e publica por design (protegida por RLS no
// banco). NUNCA usar a service_role no frontend.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || __SUPABASE_URL_FALLBACK__ || undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || __SUPABASE_ANON_KEY_FALLBACK__ || undefined;

if (!url || !anonKey) {
  // Nao derruba o app: telas que ainda nao usam Supabase seguem funcionando.
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ou SUPABASE_URL / SUPABASE_ANON_KEY) nao configurados.');
}

export const isSupabaseConfigured = Boolean(url && anonKey);

// createClient() lanca erro sincrono ("supabaseUrl is required") se a URL for
// vazia — isso derrubava o app INTEIRO (nao so as telas que usam Supabase) sempre
// que a env var estivesse ausente/com nome errado. Usamos uma URL placeholder
// valida (nunca chamada de verdade, pois todo call-site checa isSupabaseConfigured
// antes de usar `supabase`) so pra o construtor nao explodir.
export const supabase = createClient(
  url || 'https://supabase-nao-configurado.invalid',
  anonKey || 'anon-key-nao-configurada',
  { auth: { persistSession: false } }
);
