import { sb } from './supabase.js';

export const state = {
  session: null,
  user: null,
  profile: null,
  perms: new Set(),
  memberships: new Map(), // project_id -> role
  suspended: false,
  recovering: false,
  settings: {},
  programs: [],
};

export const can = (p) => state.perms.has(p);
export const myRole = () => state.profile?.role || null;
export const isAdmin = () => ['super_admin', 'org_admin'].includes(myRole());
export const isStaff = () => !!state.profile && state.profile.role !== 'external';
export const isManagerOf = (projectId) => !!projectId && state.memberships.get(projectId) === 'manager';

/** Can the current user edit / submit / archive this asset (mirrors the database rule)? */
export function canManageAsset(a) {
  if (!state.user || !a) return false;
  return isAdmin() || a.uploaded_by === state.user.id || isManagerOf(a.project_id);
}
export const canEditAsset = (a) => can('edit_metadata') && canManageAsset(a) && !a.deleted_at;

export async function loadSession() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;
  state.profile = null;
  state.perms = new Set();
  state.memberships = new Map();
  state.suspended = false;
  if (state.user) await loadProfile();
  return state;
}

export async function loadProfile() {
  const { data: profile } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
  state.profile = profile;
  if (!profile) return;
  if (profile.status === 'suspended') { state.suspended = true; state.perms = new Set(); return; }
  const [perms, members] = await Promise.all([
    sb.from('role_permissions').select('permission').eq('role', profile.role),
    sb.from('project_members').select('project_id,role').eq('user_id', state.user.id),
  ]);
  state.perms = new Set((perms.data || []).map((p) => p.permission));
  state.memberships = new Map((members.data || []).map((m) => [m.project_id, m.role]));
}

export async function loadPublicRefs(force = false) {
  if (state.programs.length && !force) return;
  const [programs, settings] = await Promise.all([
    sb.from('program_areas').select('*').order('sort_order'),
    sb.from('site_settings').select('key,value'),
  ]);
  state.programs = programs.data || [];
  state.settings = Object.fromEntries((settings.data || []).map((s) => [s.key, s.value]));
}

export async function signOut() {
  await sb.auth.signOut();
  state.session = null; state.user = null; state.profile = null; state.perms = new Set();
}

/** Where a signed-in person lands first. */
export const defaultHome = () => (state.profile?.role === 'external' ? '/app/shared' : '/app');
/** Only allow in-app hash paths as post-login destinations (no open redirects). */
export function safeNext(n) {
  return typeof n === 'string' && /^\/(app|s)(\/|$)/.test(n) ? n : null;
}
