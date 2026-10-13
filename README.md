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

## Environment variables & URLs
Set the same three **public** values wherever you deploy (see `.env.example`):

| Name | Where | Value |
|---|---|---|
| `SUPABASE_URL` | Vercel env var / GitHub Actions variable | `https://nfrrkbxlndzufqierwqd.supabase.co` |
| `SUPABASE_ANON_KEY` | same | Supabase -> Project Settings -> API (anon / publishable key) |
| `SITE_URL` | same | Public site address, no trailing slash, e.g. `https://terra-vault.vercel.app` |

`npm run build` writes them to `js/env.js`; if nothing is set the defaults in `js/config.js` are used.
Never add the `service_role` key to this project.

**Supabase -> Authentication -> URL Configuration**
- *Site URL*: the same value as `SITE_URL`
- *Redirect URLs*: `SITE_URL`, `SITE_URL/**`, and `http://localhost:8000/**` for local work

These are required for the confirmation and **Forgot password** e-mails to open the right site.

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
