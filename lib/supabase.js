import { createClient } from '@supabase/supabase-js';

// Vercel inject biến môi trường tự động; dotenv dùng cho local dev qua server.js
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase] Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// ── LEVELS ──────────────────────────────────────────────
export async function getLevels() {
  const { data, error } = await supabase.from('levels').select('*').order('sort_order');
  if (error) throw error;
  return data;
}

export async function createLevel({ name, color, parent_id, description, sort_order }) {
  const { data, error } = await supabase.from('levels')
    .insert({ name, color, parent_id: parent_id || null, description, sort_order: sort_order ?? 0 })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteLevel(id) {
  const { error } = await supabase.from('levels').delete().eq('id', id);
  if (error) throw error;
}

// ── CONTACTS ────────────────────────────────────────────
export async function getContacts({ levelId, search, status } = {}) {
  let q = supabase.from('contacts')
    .select('*, levels(id, name, color, parent_id)')
    .order('created_at', { ascending: false });
  if (levelId) q = q.eq('level_id', levelId);
  if (status)  q = q.eq('status', status);
  if (search)  q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function getContactsByLevelIds(levelIds) {
  const { data, error } = await supabase.from('contacts')
    .select('*, levels(id, name, color)')
    .in('level_id', levelIds).eq('status', 'active');
  if (error) throw error;
  return data;
}

export async function upsertContacts(rows) {
  const { data, error } = await supabase.from('contacts')
    .upsert(rows, { onConflict: 'email' }).select();
  if (error) throw error;
  return data;
}

export async function updateContactLevel(contactId, levelId) {
  const { error } = await supabase.from('contacts')
    .update({ level_id: levelId }).eq('id', contactId);
  if (error) throw error;
}

export async function deleteContact(id) {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) throw error;
}

export async function markLastSent(contactIds) {
  const { error } = await supabase.from('contacts')
    .update({ last_sent_at: new Date().toISOString() }).in('id', contactIds);
  if (error) throw error;
}

// ── TEMPLATES ───────────────────────────────────────────
export async function getTemplates() {
  const { data, error } = await supabase.from('templates').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function createTemplate({ name, icon, description, body, tags }) {
  const { data, error } = await supabase.from('templates')
    .insert({ name, icon: icon || '📄', description, body, tags: tags || [] })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateTemplate(id, { name, icon, description, body, tags }) {
  const { data, error } = await supabase.from('templates')
    .update({ name, icon, description, body, tags }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTemplate(id) {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw error;
}

// ── CAMPAIGNS ───────────────────────────────────────────
export async function getCampaigns() {
  const { data, error } = await supabase.from('campaigns').select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createCampaign(payload) {
  const { data, error } = await supabase.from('campaigns')
    .insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateCampaignStatus(id, { status, sent_count, failed_count }) {
  const { error } = await supabase.from('campaigns')
    .update({ status, sent_count, failed_count, sent_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// ── SEND LOGS ───────────────────────────────────────────
export async function logSend({ campaign_id, contact_id, email, level, status, resend_id, error_msg }) {
  const { error } = await supabase.from('send_logs').insert({
    campaign_id, contact_id: contact_id || null, email, level, status,
    resend_id: resend_id || null, error_msg: error_msg || null,
  });
  if (error) console.error('[logSend]', error.message);
}

export async function getCampaignLogs(campaignId) {
  const { data, error } = await supabase.from('send_logs')
    .select('*').eq('campaign_id', campaignId).order('sent_at');
  if (error) throw error;
  return data;
}

// ── STATS ───────────────────────────────────────────────
export async function getDashStats() {
  const [lv, ct, ca] = await Promise.all([
    supabase.from('levels').select('id, name, color, parent_id'),
    supabase.from('contacts').select('id, level_id, status'),
    supabase.from('campaigns').select('id, name, status, sent_count, failed_count, target_levels, sent_at')
      .order('created_at', { ascending: false }).limit(10),
  ]);
  return { levels: lv.data || [], contacts: ct.data || [], recentCampaigns: ca.data || [] };
}
