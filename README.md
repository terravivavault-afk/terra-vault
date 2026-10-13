# TerraVault by Terraviva

*Protecting Nature, Empowering Communities.* — *Kulinda Mazingira, Kuwawezesha Jamii.*

TerraVault is Terraviva's Digital Asset Management platform: a private staff workspace
(upload, classify, review, publish, share, report) plus a public media library of approved content.
Interface is bilingual (English / Kiswahili).

## Stack
- Static single-page app (ES modules, hash router, no build step) — hosted on GitHub Pages
- Supabase: Postgres + Row Level Security, Auth, private Storage bucket `assets`, Edge Function `share-access`
- Schema lives in `supabase/migrations/` (apply in order)

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000

`js/config.js` holds the project URL and the *public* anon key (safe in the browser: all tables are protected by RLS).

## Structure
| Path | Purpose |
|---|---|
| `index.html`, `css/app.css` | Entry page and the full design system |
| `js/app.js`, `js/shell.js` | Router, session guard, public/workspace chrome |
| `js/pages/` | Public library, auth, dashboard, assets, projects, collections, approvals, sharing, trash, reports, users, settings |
| `js/lib/` | Supabase client, permissions state, uploader, previews, charts, i18n |
| `supabase/` | Migrations and edge function |

## First admin
After the first sign-up, promote that profile to `super_admin` in the Supabase SQL editor:
    update public.profiles set role = 'super_admin' where email = 'you@example.org';
