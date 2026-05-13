// Singleton service-role Supabase client for Edge Functions. The
// service role bypasses RLS so the function can perform any read or
// write — protect it with the auth helpers in ./auth.ts.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  return cached;
}
