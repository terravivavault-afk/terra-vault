// Queries for the public library. Only columns granted to the anonymous role are used.
import { sb } from './supabase.js';
import { PUBLIC_ASSET_SELECT } from './api.js';
import { PAGE_SIZE } from '../config.js';

const clean = (w) => w.replace(/[,()*%_\\:"']/g, ' ').trim();

export async function searchPublic({ q = '', cat = '', program = '', project = '', tag = '', sort = 'new', page = 1 } = {}) {
  let query = sb.from('assets')
    .select(PUBLIC_ASSET_SELECT + (tag ? ',filter_tags:asset_tags!inner(tag_id)' : ''), { count: 'exact' })
    .eq('status', 'published').is('deleted_at', null);
  if (cat) query = query.eq('category', cat);
  if (program) query = query.eq('program_id', program);
  if (project) query = query.eq('project_id', project);
  if (tag) query = query.eq('filter_tags.tag_id', tag);
  clean(q).split(/\s+/).filter(Boolean).slice(0, 6).forEach((w) => {
    query = query.or(`title.ilike.%${w}%,description.ilike.%${w}%,creator.ilike.%${w}%,region.ilike.%${w}%,district.ilike.%${w}%,ward.ilike.%${w}%`);
  });
  query = sort === 'old' ? query.order('published_at', { ascending: true })
    : sort === 'title' ? query.order('title', { ascending: true })
    : query.order('published_at', { ascending: false });
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}

export async function publicCounts() {
  const { data } = await sb.from('assets').select('program_id,category').eq('status', 'published').is('deleted_at', null).limit(2000);
  const rows = data || [];
  const byProgram = {}; const byCat = {};
  rows.forEach((r) => {
    if (r.program_id) byProgram[r.program_id] = (byProgram[r.program_id] || 0) + 1;
    byCat[r.category] = (byCat[r.category] || 0) + 1;
  });
  return { total: rows.length, byProgram, byCat };
}
