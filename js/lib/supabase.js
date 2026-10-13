import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

// PKCE keeps auth redirects in the query string, so they never collide with the #/hash router.
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
