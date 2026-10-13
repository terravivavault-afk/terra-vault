# TerraVault by Terraviva

*Protecting Nature, Empowering Communities.* — *Kulinda Mazingira, Kuwawezesha Jamii.*

TerraVault is Terraviva's Digital Asset Management platform: a private staff workspace
(upload, classify, review, publish, share, report) plus a public media library of approved content.
Interface is bilingual (English / Kiswahili).

## Stack
- Static single-page app (ES modules, hash router, no build step) — hosted on Vercel (auto-deploys from `main`)
- Supabase: Postgres + Row Level Security, Auth, private Storage bucket `assets`, Edge Function `share-access`
- Schema lives in `supabase/migrations/` (apply in order)

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000

`js/config.js` holds the project URL and the *public* anon key (safe in the browser: all tables are protected by RLS).

## Environment variables & URLs
Set the same three **public** values wherever you deploy (see `.env.example`):

| Name | Where | Value |
|---|---|---|
| `SUPABASE_URL` | Vercel environment variable | `https://nfrrkbxlndzufqierwqd.supabase.co` |
| `SUPABASE_ANON_KEY` | same | Supabase -> Project Settings -> API (anon / publishable key) |
| `SITE_URL` | same | Public site address, no trailing slash, e.g. `https://terra-vault.vercel.app` |

| `CLOUDINARY_CLOUD_NAME` | same | `jnwhkmj0` |
| `CLOUDINARY_UPLOAD_PRESET` | same | `terravault_unsigned` (must be an **Unsigned** preset) |

`npm run build` writes them to `js/env.js`; if nothing is set the defaults in `js/config.js` are used.
Never add the `service_role` key to this project.

**Supabase -> Authentication -> URL Configuration**
- *Site URL*: the same value as `SITE_URL`
- *Redirect URLs*: `SITE_URL`, `SITE_URL/**`, and `http://localhost:8000/**` for local work

These are required for the confirmation and **Forgot password** e-mails to open the right site.

## Cloudinary (public media only)
Published **photos and videos** get an optimised copy on Cloudinary (auto format/quality, resized thumbnails) used by the public library.
- Private originals and every non-public file stay in the private Supabase bucket; downloads still come from Supabase.
- If Cloudinary fails or is not configured, the public library falls back to Supabase automatically.
- Limits (free plan): images up to 10 MB, videos up to 100 MB; larger files and TIFF are not mirrored.
- An unsigned preset cannot delete. When someone **unpublishes** a file the app shows its Cloudinary id; delete it in the Cloudinary Media Library (folder `terravault/`), otherwise its link keeps working.
- Cloudinary preset hardening: Settings -> Upload -> Upload presets -> `terravault_unsigned`: allowed formats `jpg,png,webp,gif,mp4,mov,webm`, max file size, folder `terravault`, *Overwrite* off. Never add the API secret to this project.
- Database: migration `20261013000005_cloudinary_public_media.sql` adds `cdn_public_id`, `cdn_resource_type`, `cdn_version` to `assets`.

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
