-- TerraVault by Terraviva — core schema
-- Protecting Nature, Empowering Communities.

create extension if not exists pg_trgm with schema extensions;

-- Helper functions live in a schema that is NOT exposed through the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------- enums
create type public.app_role as enum (
  'super_admin', 'org_admin', 'executive', 'project_manager',
  'contributor', 'viewer', 'external'
);
create type public.account_status as enum ('active', 'suspended');
create type public.asset_category as enum ('photo', 'video', 'document', 'audio', 'other');
create type public.asset_status as enum (
  'draft', 'pending_review', 'changes_requested', 'approved',
  'published', 'archived', 'rejected'
);
create type public.confidentiality_level as enum ('public', 'internal', 'restricted', 'confidential');
create type public.project_member_role as enum ('manager', 'member', 'viewer');

-- ---------------------------------------------------------------- people
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  phone text,
  organization text,
  job_title text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'sw')),
  role public.app_role not null default 'external',
  status public.account_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role public.app_role not null default 'contributor',
  note text,
  invited_by uuid references public.profiles (id) on delete set null default auth.uid(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_open_email_key on public.invitations (lower(email)) where accepted_at is null;

create table public.role_permissions (
  role public.app_role not null,
  permission text not null,
  primary key (role, permission)
);

create table public.site_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ---------------------------------------------------------------- structure
create table public.program_areas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  name_sw text,
  description text,
  color text not null default '#0F7B7B',
  icon text not null default 'leaf',
  is_sensitive boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  description text,
  program_id uuid references public.program_areas (id) on delete set null,
  geographic_coverage text,
  start_date date,
  end_date date,
  manager_id uuid references public.profiles (id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'on_hold')),
  is_restricted boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_program_idx on public.projects (program_id);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_standard boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index tags_name_key on public.tags (lower(name));

create table public.metadata_fields (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  label_sw text,
  field_type text not null default 'text' check (field_type in ('text', 'textarea', 'select', 'date', 'boolean', 'number')),
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0
);

-- ---------------------------------------------------------------- assets
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  description text,
  filename text not null,
  storage_path text not null,
  thumbnail_path text,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  checksum text,
  category public.asset_category not null default 'other',
  project_id uuid references public.projects (id) on delete set null,
  program_id uuid references public.program_areas (id) on delete set null,
  department text,
  country text default 'Tanzania',
  region text,
  district text,
  ward text,
  captured_at date,
  creator text,
  language text,
  copyright_holder text,
  usage_rights text,
  keywords text[] not null default '{}',
  custom_metadata jsonb not null default '{}'::jsonb,
  confidentiality public.confidentiality_level not null default 'internal',
  status public.asset_status not null default 'draft',
  status_note text,
  version int not null default 1,
  public_download boolean not null default true,
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only explicitly public files may ever be published.
  constraint assets_published_must_be_public check (status <> 'published' or confidentiality = 'public')
);
create index assets_project_idx on public.assets (project_id);
create index assets_program_idx on public.assets (program_id);
create index assets_status_idx on public.assets (status) where deleted_at is null;
create index assets_category_idx on public.assets (category);
create index assets_uploader_idx on public.assets (uploaded_by);
create index assets_created_idx on public.assets (created_at desc);
create index assets_checksum_idx on public.assets (checksum);
create index assets_keywords_idx on public.assets using gin (keywords);
create index assets_search_idx on public.assets using gin (search_text extensions.gin_trgm_ops);

create table public.asset_stats (
  asset_id uuid primary key references public.assets (id) on delete cascade,
  views bigint not null default 0,
  downloads bigint not null default 0,
  last_viewed_at timestamptz
);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  version int not null,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  file_size bigint not null default 0,
  checksum text,
  note text,
  uploaded_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (asset_id, version)
);

create table public.asset_tags (
  asset_id uuid not null references public.assets (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (asset_id, tag_id)
);
create index asset_tags_tag_idx on public.asset_tags (tag_id);

create table public.asset_comments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index asset_comments_asset_idx on public.asset_comments (asset_id, created_at);

create table public.approval_history (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  from_status public.asset_status,
  to_status public.asset_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);
create index approval_history_asset_idx on public.approval_history (asset_id, created_at);

-- ---------------------------------------------------------------- collections
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  description text,
  visibility text not null default 'private' check (visibility in ('private', 'organization')),
  owner_id uuid references public.profiles (id) on delete set null default auth.uid(),
  cover_asset_id uuid references public.assets (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collection_assets (
  collection_id uuid not null references public.collections (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (collection_id, asset_id)
);
create index collection_assets_asset_idx on public.collection_assets (asset_id);

-- ---------------------------------------------------------------- sharing
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets (id) on delete cascade,
  collection_id uuid references public.collections (id) on delete cascade,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  shared_with_email text,
  allow_download boolean not null default true,
  require_auth boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  note text,
  access_count int not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint shares_one_target check ((asset_id is not null) <> (collection_id is not null)),
  -- Open links must always expire; named-user shares may be open-ended.
  constraint shares_links_expire check (shared_with_email is not null or expires_at is not null)
);
create index shares_asset_idx on public.shares (asset_id);
create index shares_collection_idx on public.shares (collection_id);
create index shares_email_idx on public.shares (lower(shared_with_email));

-- ---------------------------------------------------------------- audit & notifications
create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  action text not null,
  entity_type text,
  entity_id uuid,
  entity_title text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);
create index activity_logs_actor_idx on public.activity_logs (actor_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
