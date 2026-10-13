-- TerraVault — row level security, storage, RPCs and seed data

-- ================================================================ reviewer guard
-- People who may review an asset but not manage it can only change workflow fields.
create or replace function private.assets_a_reviewer_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ignore text[] := array['status', 'status_note', 'published_at', 'published_by', 'updated_at', 'deleted_at', 'deleted_by'];
begin
  if v_uid is null then
    return new;
  end if;
  if not private.can_manage_asset(old.uploaded_by, old.project_id) then
    if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
      raise exception 'You can review this asset but not edit it.' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and new.status in ('approved', 'changes_requested', 'rejected')
       and private.user_role() = 'project_manager'
       and not private.is_project_manager(old.project_id) then
      raise exception 'Project managers can only review assets of projects they manage.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger assets_a_reviewer_guard_trg before update on public.assets
  for each row execute function private.assets_a_reviewer_guard();

-- ================================================================ enable RLS
alter table public.profiles enable row level security;
alter table public.invitations enable row level security;
alter table public.role_permissions enable row level security;
alter table public.site_settings enable row level security;
alter table public.program_areas enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tags enable row level security;
alter table public.metadata_fields enable row level security;
alter table public.assets enable row level security;
alter table public.asset_stats enable row level security;
alter table public.asset_versions enable row level security;
alter table public.asset_tags enable row level security;
alter table public.asset_comments enable row level security;
alter table public.approval_history enable row level security;
alter table public.collections enable row level security;
alter table public.collection_assets enable row level security;
alter table public.shares enable row level security;
alter table public.activity_logs enable row level security;
alter table public.notifications enable row level security;

-- ================================================================ grants
revoke all on all tables in schema public from anon;
grant select on public.program_areas, public.tags to anon;
grant select on public.site_settings to anon;
grant select on public.asset_tags to anon;
grant select (id, name, code, description, program_id, geographic_coverage, start_date, end_date, status)
  on public.projects to anon;
grant select (id, title, description, category, mime_type, file_size, storage_path, thumbnail_path,
              project_id, program_id, country, region, district, ward, captured_at, creator, language,
              copyright_holder, usage_rights, keywords, status, deleted_at, public_download,
              published_at, created_at)
  on public.assets to anon;

-- ================================================================ profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_staff());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or private.has_perm('manage_users'))
  with check (id = (select auth.uid()) or private.has_perm('manage_users'));

-- invitations
create policy invitations_all on public.invitations for all to authenticated
  using (private.has_perm('manage_users')) with check (private.has_perm('manage_users'));

-- role_permissions
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (private.user_role() = 'super_admin') with check (private.user_role() = 'super_admin');

-- site_settings
create policy site_settings_public on public.site_settings for select to anon using (is_public);
create policy site_settings_select on public.site_settings for select to authenticated using (true);
create policy site_settings_write on public.site_settings for all to authenticated
  using (private.has_perm('manage_settings')) with check (private.has_perm('manage_settings'));

-- program_areas
create policy program_areas_select on public.program_areas for select to anon, authenticated using (true);
create policy program_areas_write on public.program_areas for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- projects
create policy projects_public on public.projects for select to anon
  using (private.project_has_published(id));
create policy projects_select on public.projects for select to authenticated
  using (
    private.is_admin()
    or private.is_project_member(id)
    or (not is_restricted and private.is_staff())
    or private.project_has_published(id)
  );
create policy projects_insert on public.projects for insert to authenticated
  with check (private.has_perm('manage_projects'));
create policy projects_update on public.projects for update to authenticated
  using (private.has_perm('manage_projects') or private.is_project_manager(id))
  with check (private.has_perm('manage_projects') or private.is_project_manager(id));
create policy projects_delete on public.projects for delete to authenticated
  using (private.is_admin());

-- project_members
create policy project_members_select on public.project_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin() or private.is_project_member(project_id));
create policy project_members_insert on public.project_members for insert to authenticated
  with check (private.has_perm('manage_projects') or private.is_project_manager(project_id));
create policy project_members_update on public.project_members for update to authenticated
  using (private.has_perm('manage_projects') or private.is_project_manager(project_id))
  with check (private.has_perm('manage_projects') or private.is_project_manager(project_id));
create policy project_members_delete on public.project_members for delete to authenticated
  using (private.has_perm('manage_projects') or private.is_project_manager(project_id));

-- tags
create policy tags_select on public.tags for select to anon, authenticated using (true);
create policy tags_insert on public.tags for insert to authenticated
  with check (private.has_perm('edit_metadata') and (not is_standard or private.is_admin()));
create policy tags_update on public.tags for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy tags_delete on public.tags for delete to authenticated using (private.is_admin());

-- metadata_fields
create policy metadata_fields_select on public.metadata_fields for select to authenticated using (true);
create policy metadata_fields_write on public.metadata_fields for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- assets
create policy assets_public on public.assets for select to anon
  using (status = 'published' and deleted_at is null);
create policy assets_select on public.assets for select to authenticated
  using (private.can_view_asset(id, project_id, confidentiality, status, uploaded_by, deleted_at));
create policy assets_insert on public.assets for insert to authenticated
  with check (
    private.has_perm('upload')
    and uploaded_by = (select auth.uid())
    and status = 'draft'
    and deleted_at is null
  );
create policy assets_update on public.assets for update to authenticated
  using (
    private.can_view_asset(id, project_id, confidentiality, status, uploaded_by, deleted_at)
    and (
      (private.has_perm('edit_metadata') and private.can_manage_asset(uploaded_by, project_id))
      or private.has_perm('approve')
      or private.has_perm('publish')
      or private.has_perm('restore')
    )
  );
create policy assets_delete on public.assets for delete to authenticated
  using (private.is_admin() and private.has_perm('delete'));

-- asset_stats
create policy asset_stats_select on public.asset_stats for select to authenticated
  using (private.can_view_asset_id(asset_id));

-- asset_versions
create policy asset_versions_select on public.asset_versions for select to authenticated
  using (private.can_view_asset_id(asset_id));
create policy asset_versions_insert on public.asset_versions for insert to authenticated
  with check (private.has_perm('replace_files') and private.can_edit_asset_id(asset_id));

-- asset_tags
create policy asset_tags_public on public.asset_tags for select to anon
  using (exists (select 1 from public.assets a where a.id = asset_id and a.status = 'published' and a.deleted_at is null));
create policy asset_tags_select on public.asset_tags for select to authenticated
  using (private.can_view_asset_id(asset_id));
create policy asset_tags_insert on public.asset_tags for insert to authenticated
  with check (private.can_edit_asset_id(asset_id));
create policy asset_tags_delete on public.asset_tags for delete to authenticated
  using (private.can_edit_asset_id(asset_id));

-- asset_comments (internal collaboration, never public)
create policy asset_comments_select on public.asset_comments for select to authenticated
  using (private.is_staff() and private.can_view_asset_id(asset_id));
create policy asset_comments_insert on public.asset_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.is_staff() and private.can_view_asset_id(asset_id));
create policy asset_comments_delete on public.asset_comments for delete to authenticated
  using (author_id = (select auth.uid()) or private.is_admin());

-- approval_history
create policy approval_history_select on public.approval_history for select to authenticated
  using (private.is_staff() and private.can_view_asset_id(asset_id));

-- collections
create policy collections_select on public.collections for select to authenticated
  using (private.can_view_collection(id));
create policy collections_insert on public.collections for insert to authenticated
  with check (private.has_perm('edit_metadata') and owner_id = (select auth.uid()));
create policy collections_update on public.collections for update to authenticated
  using (private.owns_collection(id)) with check (private.owns_collection(id));
create policy collections_delete on public.collections for delete to authenticated
  using (private.owns_collection(id));

create policy collection_assets_select on public.collection_assets for select to authenticated
  using (private.can_view_collection(collection_id));
create policy collection_assets_insert on public.collection_assets for insert to authenticated
  with check (private.owns_collection(collection_id) and private.can_view_asset_id(asset_id));
create policy collection_assets_delete on public.collection_assets for delete to authenticated
  using (private.owns_collection(collection_id));

-- shares
create policy shares_select on public.shares for select to authenticated
  using (
    created_by = (select auth.uid())
    or private.is_admin()
    or lower(shared_with_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
create policy shares_insert on public.shares for insert to authenticated
  with check (
    private.has_perm('share')
    and created_by = (select auth.uid())
    and (asset_id is null or private.can_view_asset_id(asset_id))
    and (collection_id is null or private.can_view_collection(collection_id))
  );
create policy shares_update on public.shares for update to authenticated
  using (created_by = (select auth.uid()) or private.is_admin())
  with check (created_by = (select auth.uid()) or private.is_admin());
create policy shares_delete on public.shares for delete to authenticated
  using (created_by = (select auth.uid()) or private.is_admin());

-- activity_logs
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (private.has_perm('view_logs') or actor_id = (select auth.uid()));
create policy activity_logs_insert on public.activity_logs for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and action in ('asset.download', 'asset.view', 'report.export', 'auth.login')
  );

-- notifications
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- ================================================================ storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assets', 'assets', false, 52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "assets bucket read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'assets' and private.can_read_object(name));
create policy "assets bucket upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and (private.has_perm('upload') or private.has_perm('replace_files'))
  );
create policy "assets bucket delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'assets'
    and (private.is_admin() or owner_id = (select auth.uid())::text)
  );

-- ================================================================ RPCs
create or replace function public.dashboard_stats()
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_counts jsonb;
  v_quota bigint;
  v_used bigint;
  v_projects jsonb;
  v_months jsonb;
  v_status jsonb;
  v_downloads bigint;
begin
  select jsonb_build_object(
    'total',      count(*) filter (where deleted_at is null),
    'photos',     count(*) filter (where deleted_at is null and category = 'photo'),
    'videos',     count(*) filter (where deleted_at is null and category = 'video'),
    'documents',  count(*) filter (where deleted_at is null and category = 'document'),
    'audio',      count(*) filter (where deleted_at is null and category = 'audio'),
    'other',      count(*) filter (where deleted_at is null and category = 'other'),
    'pending',    count(*) filter (where deleted_at is null and status = 'pending_review'),
    'published',  count(*) filter (where deleted_at is null and status = 'published'),
    'trashed',    count(*) filter (where deleted_at is not null)
  ) into v_counts from public.assets;

  select coalesce(sum(v.file_size), 0) into v_used from public.asset_versions v;

  select coalesce((value #>> '{}')::bigint, 0) into v_quota
  from public.site_settings where key = 'storage_quota_bytes';

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', cnt) order by cnt desc), '[]'::jsonb)
  into v_projects
  from (
    select coalesce(p.name, 'No project') as name, count(*) as cnt
    from public.assets a left join public.projects p on p.id = a.project_id
    where a.deleted_at is null
    group by coalesce(p.name, 'No project')
    order by cnt desc limit 8
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'count', coalesce(c.cnt, 0)) order by m), '[]'::jsonb)
  into v_months
  from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
  left join (
    select date_trunc('month', created_at) as mo, count(*) as cnt
    from public.assets where deleted_at is null group by 1
  ) c on c.mo = m;

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_status
  from (select status, count(*) as cnt from public.assets where deleted_at is null group by status) s;

  select coalesce(sum(downloads), 0) into v_downloads from public.asset_stats;

  return v_counts || jsonb_build_object(
    'storage_used', v_used,
    'storage_quota', v_quota,
    'by_project', v_projects,
    'by_month', v_months,
    'by_status', v_status,
    'downloads', v_downloads,
    'active_shares', (select count(*) from public.shares s
                      where s.revoked_at is null and (s.expires_at is null or s.expires_at > now())),
    'users', (select count(*) from public.profiles where private.is_staff())
  );
end;
$$;

create or replace function public.replace_asset_file(
  p_asset uuid, p_path text, p_filename text, p_mime text, p_size bigint,
  p_checksum text, p_thumb text default null, p_note text default null
)
returns int
language plpgsql security invoker set search_path = ''
as $$
declare
  v_version int;
begin
  select version into v_version from public.assets where id = p_asset for update;
  if v_version is null then
    raise exception 'Asset not found or not accessible.' using errcode = '42501';
  end if;
  insert into public.asset_versions (asset_id, version, storage_path, filename, mime_type, file_size, checksum, note)
  values (p_asset, v_version + 1, p_path, p_filename, p_mime, p_size, p_checksum, p_note);
  update public.assets
     set storage_path = p_path, filename = p_filename, mime_type = p_mime, file_size = p_size,
         checksum = p_checksum, thumbnail_path = p_thumb, version = v_version + 1
   where id = p_asset;
  perform private.write_log('asset.version_added', 'asset', p_asset, p_filename,
    jsonb_build_object('version', v_version + 1));
  return v_version + 1;
end;
$$;

create or replace function public.track_asset_event(p_asset uuid, p_kind text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_kind not in ('view', 'download') then
    return;
  end if;
  if not exists (select 1 from public.assets where id = p_asset and status = 'published' and deleted_at is null)
     and not private.can_view_asset_id(p_asset) then
    return;
  end if;
  insert into public.asset_stats (asset_id, views, downloads, last_viewed_at)
  values (p_asset, case when p_kind = 'view' then 1 else 0 end, case when p_kind = 'download' then 1 else 0 end, now())
  on conflict (asset_id) do update
    set views = public.asset_stats.views + excluded.views,
        downloads = public.asset_stats.downloads + excluded.downloads,
        last_viewed_at = now();
end;
$$;

revoke execute on function public.dashboard_stats() from public, anon;
revoke execute on function public.replace_asset_file(uuid, text, text, text, bigint, text, text, text) from public, anon;
grant execute on function public.dashboard_stats() to authenticated;
grant execute on function public.replace_asset_file(uuid, text, text, text, bigint, text, text, text) to authenticated;
grant execute on function public.track_asset_event(uuid, text) to anon, authenticated;

-- ================================================================ seed data
insert into public.role_permissions (role, permission)
select r.role::public.app_role, p.permission
from (values
  ('super_admin'), ('org_admin')
) as r(role)
cross join (values
  ('view'), ('upload'), ('edit_metadata'), ('replace_files'), ('download'), ('delete'), ('restore'),
  ('share'), ('approve'), ('publish'), ('manage_users'), ('manage_projects'), ('export_reports'),
  ('view_logs'), ('manage_settings')
) as p(permission);

insert into public.role_permissions (role, permission) values
  ('executive', 'view'), ('executive', 'download'), ('executive', 'approve'), ('executive', 'export_reports'),
  ('project_manager', 'view'), ('project_manager', 'upload'), ('project_manager', 'edit_metadata'),
  ('project_manager', 'replace_files'), ('project_manager', 'download'), ('project_manager', 'delete'),
  ('project_manager', 'restore'), ('project_manager', 'share'), ('project_manager', 'approve'),
  ('project_manager', 'export_reports'),
  ('contributor', 'view'), ('contributor', 'upload'), ('contributor', 'edit_metadata'), ('contributor', 'download'),
  ('viewer', 'view'), ('viewer', 'download'),
  ('external', 'view');

insert into public.program_areas (slug, name, name_sw, description, color, icon, is_sensitive, sort_order) values
  ('environmental-conservation', 'Environmental Conservation', 'Uhifadhi wa Mazingira',
   'Tree planting, biodiversity, waste management, restoration and climate change education around Lake Victoria and beyond.',
   '#4A7023', 'trees', false, 1),
  ('sustainable-agriculture', 'Sustainable Agriculture', 'Kilimo Endelevu',
   'Agroforestry, composting, soil conservation and climate-smart farming resources for farmers.',
   '#C4874A', 'sprout', false, 2),
  ('youth-women-empowerment', 'Youth and Women Empowerment', 'Uwezeshaji wa Vijana na Wanawake',
   'Training, workshops and livelihood development resources for young people and women.',
   '#16B3A8', 'users', false, 3),
  ('reproductive-health-education', 'Reproductive Health Education', 'Elimu ya Afya ya Uzazi',
   'Approved educational publications and awareness resources. Files here may be sensitive and are protected by default.',
   '#B5547A', 'heart-pulse', true, 4),
  ('organizational-resources', 'Organizational Resources', 'Rasilimali za Shirika',
   'Policies, templates, approved reports, presentations and communication materials.',
   '#3B5F73', 'building-2', false, 5);

insert into public.tags (name, slug, is_standard) values
  ('Climate Change', 'climate-change', true),
  ('Biodiversity', 'biodiversity', true),
  ('Tree Planting', 'tree-planting', true),
  ('Agroforestry', 'agroforestry', true),
  ('Sustainable Agriculture', 'sustainable-agriculture', true),
  ('Waste Management', 'waste-management', true),
  ('Youth Empowerment', 'youth-empowerment', true),
  ('Women Empowerment', 'women-empowerment', true),
  ('Reproductive Health Education', 'reproductive-health-education', true),
  ('Lake Victoria', 'lake-victoria', true),
  ('Community Development', 'community-development', true),
  ('Annual Report', 'annual-report', true),
  ('Training', 'training', true),
  ('Press', 'press', true);

insert into public.site_settings (key, value, is_public) values
  ('org_name', '"Terraviva"', true),
  ('product_name', '"TerraVault"', true),
  ('slogan', '"Protecting Nature, Empowering Communities."', true),
  ('slogan_sw', '"Kulinda Mazingira, Kuwawezesha Jamii."', true),
  ('contact_email', '""', true),
  ('contact_phone', '""', true),
  ('contact_address', '"Mwanza, Tanzania"', true),
  ('website', '""', true),
  ('storage_quota_bytes', '1073741824', false),
  ('max_upload_bytes', '52428800', false),
  ('require_publish_approval', 'true', false);

insert into public.metadata_fields (key, label, label_sw, field_type, options, sort_order) values
  ('event_name', 'Event or activity', 'Tukio au shughuli', 'text', '[]', 1),
  ('beneficiary_group', 'Beneficiary group', 'Kundi lengwa', 'select',
   '["Youth", "Women", "Farmers", "Schools", "Community", "Mixed"]', 2),
  ('consent_obtained', 'Consent obtained for people shown', 'Ridhaa ya watu waliopigwa picha', 'select',
   '["Yes", "No", "Not applicable"]', 3);
