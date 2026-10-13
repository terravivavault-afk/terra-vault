-- TerraVault — access helpers, workflow enforcement and audit triggers

-- ================================================================ helpers
create or replace function private.user_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and status = 'active'
$$;

create or replace function private.has_perm(p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on rp.role = pr.role
    where pr.id = (select auth.uid())
      and pr.status = 'active'
      and rp.permission = p_permission
  )
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.user_role() in ('super_admin', 'org_admin'), false)
$$;

create or replace function private.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.user_role() <> 'external', false)
$$;

create or replace function private.is_member_of(p_user uuid, p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_project is not null and exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = p_user
  )
$$;

create or replace function private.is_project_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_member_of((select auth.uid()), p_project)
$$;

create or replace function private.is_project_manager(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_project is not null and exists (
    select 1 from public.project_members
    where project_id = p_project and user_id = (select auth.uid()) and role = 'manager'
  )
$$;

-- Named-user shares: the signed-in user's e-mail matches an active share.
create or replace function private.has_share_access(p_asset uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.shares s
    where s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
      and lower(s.shared_with_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      and (
        s.asset_id = p_asset
        or (s.collection_id is not null and exists (
          select 1 from public.collection_assets ca
          where ca.collection_id = s.collection_id and ca.asset_id = p_asset))
      )
  )
$$;

-- The one place that decides who can see an asset. Search, previews, storage
-- and public APIs all rely on it, so confidential files never leak.
create or replace function private.can_view_asset(
  p_id uuid, p_project uuid, p_conf public.confidentiality_level,
  p_status public.asset_status, p_uploader uuid, p_deleted timestamptz
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.app_role;
  v_uid uuid := (select auth.uid());
  v_restricted boolean := false;
begin
  if p_deleted is not null then
    return v_uid is not null and (private.is_admin() or p_uploader = v_uid);
  end if;
  if p_status = 'published' then
    return true;
  end if;
  if v_uid is null then
    return false;
  end if;
  v_role := private.user_role();
  if v_role is null then
    return false;
  end if;
  if v_role in ('super_admin', 'org_admin') or p_uploader = v_uid then
    return true;
  end if;
  if p_project is not null then
    select is_restricted into v_restricted from public.projects where id = p_project;
  end if;
  if private.is_project_member(p_project) then
    return p_conf <> 'confidential';
  end if;
  if v_role = 'external' then
    return private.has_share_access(p_id);
  end if;
  if coalesce(v_restricted, false) then
    return false;
  end if;
  return p_conf in ('public', 'internal');
end;
$$;

create or replace function private.can_view_asset_id(p_asset uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assets a
    where a.id = p_asset
      and private.can_view_asset(a.id, a.project_id, a.confidentiality, a.status, a.uploaded_by, a.deleted_at)
  )
$$;

create or replace function private.can_manage_asset(p_uploader uuid, p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
      or p_uploader = (select auth.uid())
      or private.is_project_manager(p_project)
$$;

create or replace function private.can_edit_asset_id(p_asset uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_perm('edit_metadata') and exists (
    select 1 from public.assets a
    where a.id = p_asset
      and a.deleted_at is null
      and private.can_manage_asset(a.uploaded_by, a.project_id)
  )
$$;

create or replace function private.owns_collection(p_collection uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.collections c
    where c.id = p_collection
      and (c.owner_id = (select auth.uid()) or private.is_admin())
  )
$$;

create or replace function private.can_view_collection(p_collection uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.collections c
    where c.id = p_collection
      and (
        c.owner_id = (select auth.uid())
        or private.is_admin()
        or (c.visibility = 'organization' and private.is_staff())
        or exists (
          select 1 from public.shares s
          where s.collection_id = c.id and s.revoked_at is null
            and (s.expires_at is null or s.expires_at > now())
            and lower(s.shared_with_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        )
      )
  )
$$;

create or replace function private.project_has_published(p_project uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assets
    where project_id = p_project and status = 'published' and deleted_at is null
  )
$$;

-- Storage: decides which objects in the private bucket may be read.
create or replace function private.can_read_object(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_asset uuid;
  a public.assets%rowtype;
begin
  begin
    v_asset := ((storage.foldername(p_name))[1])::uuid;
  exception when others then
    return false;
  end;
  select * into a from public.assets where id = v_asset;
  if not found then
    return false;
  end if;
  -- Published files: only the current file and thumbnail are public.
  if a.status = 'published' and a.deleted_at is null
     and p_name in (a.storage_path, coalesce(a.thumbnail_path, '')) then
    return true;
  end if;
  if (select auth.uid()) is null then
    return false;
  end if;
  if not private.can_view_asset(a.id, a.project_id, a.confidentiality, a.status, a.uploaded_by, a.deleted_at) then
    return false;
  end if;
  -- Older versions are only for people who may manage the asset.
  if p_name in (a.storage_path, coalesce(a.thumbnail_path, '')) then
    return true;
  end if;
  return private.can_manage_asset(a.uploaded_by, a.project_id);
end;
$$;

-- ================================================================ audit helpers
create or replace function private.write_log(
  p_action text, p_type text, p_id uuid, p_title text, p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
begin
  if v_uid is not null then
    select coalesce(full_name, email) into v_name from public.profiles where id = v_uid;
  end if;
  insert into public.activity_logs (actor_id, actor_name, action, entity_type, entity_id, entity_title, metadata)
  values (v_uid, v_name, p_action, p_type, p_id, p_title, coalesce(p_meta, '{}'::jsonb));
end;
$$;

-- ================================================================ updated_at
create or replace function private.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
  for each row execute function private.touch_updated_at();
create trigger collections_touch before update on public.collections
  for each row execute function private.touch_updated_at();

-- ================================================================ new users
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.app_role := 'external';
  v_inv public.invitations%rowtype;
begin
  if not exists (select 1 from public.profiles) then
    -- The very first account becomes the Super Administrator.
    v_role := 'super_admin';
  else
    select * into v_inv from public.invitations
    where lower(email) = lower(new.email) and accepted_at is null
    order by created_at desc limit 1;
    if found then
      v_role := v_inv.role;
      update public.invitations set accepted_at = now() where id = v_inv.id;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    v_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ================================================================ profiles guard
create or replace function private.profiles_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.email := old.email;
  new.updated_at := now();
  if new.role is distinct from old.role or new.status is distinct from old.status then
    if v_uid is not null then
      if not private.has_perm('manage_users') then
        raise exception 'You are not allowed to change roles or account status.' using errcode = '42501';
      end if;
      if new.id = v_uid then
        raise exception 'You cannot change your own role or status.' using errcode = '42501';
      end if;
      if (old.role = 'super_admin' or new.role = 'super_admin') and private.user_role() <> 'super_admin' then
        raise exception 'Only a Super Administrator can manage Super Administrators.' using errcode = '42501';
      end if;
    end if;
    perform private.write_log(
      case when new.role is distinct from old.role then 'user.role_changed' else 'user.status_changed' end,
      'user', new.id, coalesce(new.full_name, new.email),
      jsonb_build_object('from_role', old.role, 'to_role', new.role, 'from_status', old.status, 'to_status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger profiles_guard_trg before update on public.profiles
  for each row execute function private.profiles_guard();

-- ================================================================ assets
create or replace function private.asset_search_text(a public.assets)
returns text
language sql immutable set search_path = ''
as $$
  select lower(concat_ws(' ',
    a.title, a.description, a.filename, a.creator, a.copyright_holder, a.department,
    a.country, a.region, a.district, a.ward, a.language,
    array_to_string(a.keywords, ' ')
  ))
$$;

create or replace function private.assets_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;
  new.search_text := private.asset_search_text(new);
  return new;
end;
$$;

create trigger assets_before_insert_trg before insert on public.assets
  for each row execute function private.assets_before_insert();

create or replace function private.assets_after_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.asset_versions (asset_id, version, storage_path, filename, mime_type, file_size, checksum, note, uploaded_by)
  values (new.id, new.version, new.storage_path, new.filename, new.mime_type, new.file_size, new.checksum, 'Original upload', new.uploaded_by);
  insert into public.approval_history (asset_id, from_status, to_status, actor_id, comment)
  values (new.id, null, new.status, new.uploaded_by, 'Uploaded');
  perform private.write_log('asset.upload', 'asset', new.id, new.title,
    jsonb_build_object('size', new.file_size, 'category', new.category));
  return new;
end;
$$;

create trigger assets_after_insert_trg after insert on public.assets
  for each row execute function private.assets_after_insert();

create or replace function private.assets_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_auto boolean := false;
  v_note text := new.status_note;
begin
  new.status_note := null;
  new.updated_at := now();

  if v_uid is not null then
    if new.uploaded_by is distinct from old.uploaded_by then
      raise exception 'The uploader of an asset cannot be changed.' using errcode = '42501';
    end if;
    if (new.storage_path is distinct from old.storage_path
        or new.file_size is distinct from old.file_size
        or new.checksum is distinct from old.checksum
        or new.mime_type is distinct from old.mime_type
        or new.version is distinct from old.version
        or new.filename is distinct from old.filename)
       and not private.has_perm('replace_files') then
      raise exception 'You are not allowed to replace files.' using errcode = '42501';
    end if;
  end if;

  new.search_text := private.asset_search_text(new);

  -- A replaced file must be reviewed again before it stays approved or public.
  if new.storage_path is distinct from old.storage_path and old.status in ('approved', 'published') then
    new.status := 'pending_review';
    new.published_at := null;
    new.published_by := null;
    v_auto := true;
    v_note := 'New file version uploaded — review required again';
  end if;

  -- Trash / restore
  if new.deleted_at is distinct from old.deleted_at and v_uid is not null then
    if new.deleted_at is not null then
      if not (private.has_perm('delete') and private.can_manage_asset(old.uploaded_by, old.project_id)) then
        raise exception 'You are not allowed to delete this asset.' using errcode = '42501';
      end if;
      if old.status = 'published' then
        if not private.has_perm('publish') then
          raise exception 'Only a publisher can remove a published asset.' using errcode = '42501';
        end if;
        new.status := 'archived';
        new.published_at := null;
        v_auto := true;
        v_note := 'Removed from the public library (moved to trash)';
      end if;
      new.deleted_by := v_uid;
    else
      if not (private.has_perm('restore') and (private.is_admin() or old.uploaded_by = v_uid)) then
        raise exception 'You are not allowed to restore this asset.' using errcode = '42501';
      end if;
      new.deleted_by := null;
    end if;
  end if;

  if new.status is distinct from old.status then
    if v_uid is not null and not v_auto then
      case new.status
        when 'pending_review' then
          if old.status not in ('draft', 'changes_requested', 'rejected') then
            raise exception 'Only drafts or assets with requested changes can be submitted for review.' using errcode = '42501';
          end if;
          if not private.can_manage_asset(old.uploaded_by, old.project_id) then
            raise exception 'You cannot submit this asset for review.' using errcode = '42501';
          end if;
        when 'approved', 'changes_requested', 'rejected' then
          if not private.has_perm('approve') then
            raise exception 'You are not allowed to review assets.' using errcode = '42501';
          end if;
          if new.status = 'approved' and old.status = 'published' then
            if not private.has_perm('publish') then
              raise exception 'Only a publisher can unpublish assets.' using errcode = '42501';
            end if;
          elsif old.status <> 'pending_review' and not private.is_admin() then
            raise exception 'This asset is not waiting for review.' using errcode = '42501';
          end if;
          if old.uploaded_by = v_uid and not private.is_admin() then
            raise exception 'You cannot review your own upload.' using errcode = '42501';
          end if;
        when 'published' then
          if old.status <> 'approved' then
            raise exception 'Only approved assets can be published.' using errcode = '42501';
          end if;
          if not private.has_perm('publish') then
            raise exception 'You are not allowed to publish assets.' using errcode = '42501';
          end if;
          new.published_at := now();
          new.published_by := v_uid;
        when 'archived' then
          if old.status = 'published' and not private.has_perm('publish') then
            raise exception 'Only a publisher can remove a published asset.' using errcode = '42501';
          end if;
          if not (private.has_perm('edit_metadata') and private.can_manage_asset(old.uploaded_by, old.project_id)) then
            raise exception 'You cannot archive this asset.' using errcode = '42501';
          end if;
        when 'draft' then
          if not (private.has_perm('restore') and private.can_manage_asset(old.uploaded_by, old.project_id)) then
            raise exception 'You cannot move this asset back to draft.' using errcode = '42501';
          end if;
        else
          null;
      end case;
    end if;
    if old.status = 'published' and new.status <> 'published' then
      new.published_at := null;
    end if;

    insert into public.approval_history (asset_id, from_status, to_status, actor_id, comment)
    values (old.id, old.status, new.status, v_uid, v_note);
    perform private.write_log('asset.' || new.status::text, 'asset', old.id, new.title,
      jsonb_build_object('from', old.status, 'note', v_note));
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    perform private.write_log(case when new.deleted_at is null then 'asset.restored' else 'asset.trashed' end,
      'asset', old.id, new.title);
  end if;

  if new.confidentiality is distinct from old.confidentiality then
    perform private.write_log('asset.confidentiality_changed', 'asset', old.id, new.title,
      jsonb_build_object('from', old.confidentiality, 'to', new.confidentiality));
  end if;

  return new;
end;
$$;

create trigger assets_before_update_trg before update on public.assets
  for each row execute function private.assets_before_update();

-- Notifications on workflow changes
create or replace function private.assets_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_title text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'pending_review' then
    insert into public.notifications (user_id, title, body, link)
    select pr.id,
           'Asset waiting for review',
           case when new.confidentiality in ('public', 'internal') then new.title else 'A restricted asset needs review' end,
           '/app/approvals'
    from public.profiles pr
    join public.role_permissions rp on rp.role = pr.role and rp.permission = 'approve'
    where pr.status = 'active'
      and pr.role <> 'external'
      and pr.id is distinct from v_uid
      and (
        (new.confidentiality in ('public', 'internal'))
        or pr.role in ('super_admin', 'org_admin')
        or (new.confidentiality = 'restricted' and private.is_member_of(pr.id, new.project_id))
      );
  elsif new.status in ('approved', 'changes_requested', 'rejected', 'published') and new.uploaded_by is not null
        and new.uploaded_by is distinct from v_uid then
    v_title := case new.status
      when 'approved' then 'Your asset was approved'
      when 'changes_requested' then 'Changes requested on your asset'
      when 'rejected' then 'Your asset was rejected'
      else 'Your asset was published' end;
    insert into public.notifications (user_id, title, body, link)
    values (new.uploaded_by, v_title, new.title, '/app/assets/' || new.id::text);
  end if;
  return new;
end;
$$;

create trigger assets_notify_trg after update on public.assets
  for each row execute function private.assets_notify();

-- ================================================================ other audit triggers
create or replace function private.shares_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conf public.confidentiality_level;
  v_title text;
begin
  if tg_op = 'INSERT' then
    if new.asset_id is not null then
      select confidentiality, title into v_conf, v_title from public.assets where id = new.asset_id;
      if v_conf = 'confidential' and (select auth.uid()) is not null and not private.is_admin() then
        raise exception 'Confidential assets cannot be shared.' using errcode = '42501';
      end if;
      if v_conf in ('restricted', 'confidential') and new.shared_with_email is null then
        raise exception 'Restricted assets can only be shared with a named, signed-in user.' using errcode = '42501';
      end if;
    else
      select name into v_title from public.collections where id = new.collection_id;
      if new.shared_with_email is null and exists (
        select 1 from public.collection_assets ca
        join public.assets a on a.id = ca.asset_id
        where ca.collection_id = new.collection_id and a.confidentiality in ('restricted', 'confidential')
      ) then
        raise exception 'This collection contains restricted assets and can only be shared with a named user.' using errcode = '42501';
      end if;
    end if;
    new.created_by := coalesce((select auth.uid()), new.created_by);
    if new.shared_with_email is not null then
      new.shared_with_email := lower(trim(new.shared_with_email));
      new.require_auth := true;
    end if;
    perform private.write_log('share.created', case when new.asset_id is not null then 'asset' else 'collection' end,
      coalesce(new.asset_id, new.collection_id), v_title,
      jsonb_build_object('named', new.shared_with_email is not null, 'expires_at', new.expires_at));
    if new.shared_with_email is not null then
      insert into public.notifications (user_id, title, body, link)
      select pr.id, 'Something was shared with you', coalesce(v_title, 'Shared item'), '/app/shared'
      from public.profiles pr where lower(pr.email) = new.shared_with_email;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.revoked_at is not null and old.revoked_at is null then
      perform private.write_log('share.revoked',
        case when new.asset_id is not null then 'asset' else 'collection' end,
        coalesce(new.asset_id, new.collection_id), null);
    end if;
    -- Sharing targets and tokens never change after creation.
    new.token := old.token;
    new.asset_id := old.asset_id;
    new.collection_id := old.collection_id;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger shares_guard_trg before insert or update on public.shares
  for each row execute function private.shares_guard();

create or replace function private.log_simple()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'projects' then
    perform private.write_log('project.created', 'project', new.id, new.name);
  elsif tg_table_name = 'collections' then
    perform private.write_log('collection.created', 'collection', new.id, new.name);
  elsif tg_table_name = 'invitations' then
    perform private.write_log('user.invited', 'user', null, new.email, jsonb_build_object('role', new.role));
  end if;
  return new;
end;
$$;

create trigger projects_log after insert on public.projects
  for each row execute function private.log_simple();
create trigger collections_log after insert on public.collections
  for each row execute function private.log_simple();
create trigger invitations_log after insert on public.invitations
  for each row execute function private.log_simple();

-- Project managers are automatically project members.
create or replace function private.project_manager_member()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.manager_id is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.manager_id, 'manager')
    on conflict (project_id, user_id) do update set role = 'manager';
  end if;
  return new;
end;
$$;

create trigger projects_manager_member_ins after insert on public.projects
  for each row execute function private.project_manager_member();
create trigger projects_manager_member_upd after update of manager_id on public.projects
  for each row when (new.manager_id is distinct from old.manager_id)
  execute function private.project_manager_member();

-- Creator of a collection can always see their own rows; keep a stats row per asset.
create or replace function private.assets_stats_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.asset_stats (asset_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger assets_stats_row_trg after insert on public.assets
  for each row execute function private.assets_stats_row();
