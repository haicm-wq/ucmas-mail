import { createClient } from '@supabase/supabase-js';

// Factory: nhận supabase client, trả về tất cả CRUD helpers
export function makeDB(sb) {
  return {
    // ── LEVELS ──────────────────────────────────────
    async getLevels() {
      const { data, error } = await sb.from('levels').select('*').order('sort_order');
      if (error) throw error;
      return data;
    },
    async createLevel({ name, color, parent_id, description, sort_order }) {
      const { data, error } = await sb.from('levels')
        .insert({ name, color, parent_id: parent_id || null, description, sort_order: sort_order ?? 0 })
        .select().single();
      if (error) throw error;
      return data;
    },
    async deleteLevel(id) {
      const { error } = await sb.from('levels').delete().eq('id', id);
      if (error) throw error;
    },

    // ── CONTACTS ────────────────────────────────────
    async getContacts({ levelId, search, status } = {}) {
      // Dùng getContactsPaged với limit cao để backward compat
      const result = await this.getContactsPaged({ levelId, search, status, offset: 0, limit: 500 });
      return result.data;
    },

    // Đếm chính xác số contacts theo từng level — dùng COUNT query thay vì fetch data
    async getContactCountsPerLevel() {
      const countMap = {};
      let offset = 0;
      const BATCH = 1000;
      // Chỉ select level_id (1 cột nhỏ) để đếm nhanh toàn bộ
      while (true) {
        const { data, error } = await sb.from('contacts')
          .select('level_id')
          .not('level_id', 'is', null)
          .range(offset, offset + BATCH - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        data.forEach(c => { countMap[c.level_id] = (countMap[c.level_id] || 0) + 1; });
        if (data.length < BATCH) break;
        offset += BATCH;
      }
      return countMap;
    },

    async getContactsPaged({ levelId, search, status, offset = 0, limit = 200 } = {}) {
      let base = sb.from('contacts')
        .select('*, levels(id, name, color, parent_id)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (levelId) base = base.eq('level_id', levelId);
      if (status)  base = base.eq('status', status);
      if (search)  base = base.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      const { data, error, count } = await base;
      if (error) throw error;
      return { data, total: count };
    },

    async getContactsByLevelIds(levelIds) {
      // Fetch tất cả, không giới hạn 1000 — dùng batch 1000/lần
      const BATCH = 1000;
      let all = [];
      let offset = 0;
      while (true) {
        const { data, error } = await sb.from('contacts')
          .select('*, levels(id, name, color)')
          .in('level_id', levelIds)
          .eq('status', 'active')
          .range(offset, offset + BATCH - 1);
        if (error) throw error;
        all = all.concat(data);
        if (data.length < BATCH) break; // hết data
        offset += BATCH;
      }
      return all;
    },
    async upsertContacts(rows) {
      const { data, error } = await sb.from('contacts')
        .upsert(rows, { onConflict: 'email' }).select();
      if (error) throw error;
      return data;
    },
    async updateContactLevel(contactId, levelId) {
      const { error } = await sb.from('contacts')
        .update({ level_id: levelId }).eq('id', contactId);
      if (error) throw error;
    },
    async deleteContact(id) {
      const { error } = await sb.from('contacts').delete().eq('id', id);
      if (error) throw error;
    },
    async markLastSent(contactIds) {
      const { error } = await sb.from('contacts')
        .update({ last_sent_at: new Date().toISOString() }).in('id', contactIds);
      if (error) throw error;
    },

    // ── TEMPLATES ───────────────────────────────────
    async getTemplates() {
      const { data, error } = await sb.from('templates').select('*').order('created_at');
      if (error) throw error;
      return data;
    },
    async createTemplate({ name, icon, description, body, tags }) {
      const { data, error } = await sb.from('templates')
        .insert({ name, icon: icon || '📄', description, body, tags: tags || [] })
        .select().single();
      if (error) throw error;
      return data;
    },
    async updateTemplate(id, { name, icon, description, body, tags }) {
      const { data, error } = await sb.from('templates')
        .update({ name, icon, description, body, tags }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async deleteTemplate(id) {
      const { error } = await sb.from('templates').delete().eq('id', id);
      if (error) throw error;
    },

    // ── CAMPAIGNS ───────────────────────────────────
    async getCampaigns() {
      const { data, error } = await sb.from('campaigns').select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    async createCampaign(payload) {
      const { data, error } = await sb.from('campaigns').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    async updateCampaignStatus(id, { status, sent_count, failed_count }) {
      const { error } = await sb.from('campaigns')
        .update({ status, sent_count, failed_count, sent_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },

    // ── SEND LOGS ───────────────────────────────────
    async logSend({ campaign_id, contact_id, email, level, status, resend_id, error_msg }) {
      const { error } = await sb.from('send_logs').insert({
        campaign_id, contact_id: contact_id || null, email, level, status,
        resend_id: resend_id || null, error_msg: error_msg || null,
      });
      if (error) console.error('[logSend]', error.message);
    },
    async getCampaignLogs(campaignId) {
      const { data, error } = await sb.from('send_logs')
        .select('*').eq('campaign_id', campaignId).order('sent_at');
      if (error) throw error;
      return data;
    },

    // ── STATS ───────────────────────────────────────
    async getDashStats() {
      const [lv, ca, countMap] = await Promise.all([
        sb.from('levels').select('id, name, color, parent_id').order('sort_order'),
        sb.from('campaigns').select('id, name, status, sent_count, failed_count, target_levels, sent_at')
          .order('created_at', { ascending: false }).limit(10),
        this.getContactCountsPerLevel(),
      ]);
      // Tổng số contacts
      const { count: totalContacts } = await sb.from('contacts').select('*', { count: 'exact', head: true });
      return {
        levels: lv.data || [],
        countMap,
        totalContacts: totalContacts || 0,
        recentCampaigns: ca.data || [],
      };
    },
  };
}

// Tiện lợi: tạo DB từ env vars (dùng cho local server.js)
export function createDBFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return makeDB(createClient(url, key));
}
