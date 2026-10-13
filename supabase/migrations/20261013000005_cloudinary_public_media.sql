-- Optional CDN mirror (Cloudinary) for PUBLISHED photos and videos only.
-- Originals and confidential files stay in the private Supabase bucket.
alter table public.assets
  add column if not exists cdn_public_id text,
  add column if not exists cdn_resource_type text,
  add column if not exists cdn_version bigint;

alter table public.assets
  drop constraint if exists assets_cdn_resource_type_check;
alter table public.assets
  add constraint assets_cdn_resource_type_check check (cdn_resource_type is null or cdn_resource_type in ('image', 'video'));

-- The anonymous role may only read these columns on rows it can already see (status = 'published').
grant select (cdn_public_id, cdn_resource_type, cdn_version) on public.assets to anon;
