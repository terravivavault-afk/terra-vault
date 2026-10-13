// TerraVault configuration.
// Values can be overridden per deployment (Vercel / GitHub Pages) through js/env.js,
// which `npm run build` generates from environment variables (see .env.example).
// The anon key is a *public* client key: it is safe in the browser because every
// table is protected by Row Level Security in the database.
const ENV = (typeof window !== 'undefined' && window.__TV_ENV__) || {};

export const SUPABASE_URL = ENV.SUPABASE_URL || 'https://nfrrkbxlndzufqierwqd.supabase.co';
export const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5mcnJrYnhsbmR6dWZxaWVyd3FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NTI3MzEsImV4cCI6MjEwNzMyODczMX0.SmGoNCKf1tPhq739ESH63W7cHYEZH-htiuahTlTeD6o';

// Public address of the site (no trailing slash). Used for e-mail links (confirm account,
// reset password). Falls back to the address the app is currently opened from.
export const SITE_URL = (ENV.SITE_URL || (typeof location !== 'undefined' ? location.origin + location.pathname : '')).replace(/\/+$/, '');

export const BUCKET = 'assets';
export const PAGE_SIZE = 24;
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
