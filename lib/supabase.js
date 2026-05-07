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

    // Đếm contacts theo level — ưu tiên SQL function (nhanh), fallback JS (tương thích)
    async getContactCountsPerLevel() {
      // Thử dùng SQL function trước (cần chạy migration-v2.sql)
      try {
        const { data, error } = await sb.rpc('count_contacts_per_level');
        if (!error && data) {
          const countMap = {};
          data.forEach(r => { countMap[r.level_id] = Number(r.count); });
          return countMap;
        }
      } catch (_) { /* fallback below */ }

      // Fallback: fetch level_id rồi đếm bằng JS
      const countMap = {};
      let offset = 0;
      const BATCH = 1000;
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
      const BATCH = 200;
      for (let i = 0; i < contactIds.length; i += BATCH) {
        const batch = contactIds.slice(i, i + BATCH);
        const { error } = await sb.from('contacts')
          .update({ last_sent_at: new Date().toISOString() }).in('id', batch);
        if (error) console.error('[markLastSent]', error.message);
      }
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
      const updates = { status, sent_at: new Date().toISOString() };
      if (sent_count >= 0) updates.sent_count = sent_count;
      if (failed_count >= 0) updates.failed_count = failed_count;
      const { error } = await sb.from('campaigns').update(updates).eq('id', id);
      if (error) throw error;
    },

    // ── SEND LOGS ───────────────────────────────────
    async logSend({ campaign_id, contact_id, email, level, status, resend_id, error_msg }) {
      const { error } = await sb.from('send_logs').upsert({
        campaign_id, contact_id: contact_id || null, email, level, status,
        resend_id: resend_id || null, error_msg: error_msg || null,
      }, { onConflict: 'campaign_id,email' });
      if (error) console.error('[logSend]', error.message);
    },
    async getCampaignLogs(campaignId) {
      const { data, error } = await sb.from('send_logs')
        .select('*').eq('campaign_id', campaignId).order('sent_at');
      if (error) throw error;
      return data;
    },
    async getContactEmailHistory(email) {
      const { data, error } = await sb.from('send_logs')
        .select('*, campaigns(name)')
        .eq('email', email)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(d => ({
        ...d,
        campaign_name: d.campaigns?.name || 'Campaign',
      }));
    },

    // ── EMAIL EVENTS (Tracking) ─────────────────────
    async logEmailEvent({ resend_email_id, event_type, recipient_email, metadata, created_at }) {
      const { error } = await sb.from('email_events').upsert({
        resend_email_id, event_type, recipient_email,
        metadata: metadata || {}, created_at: created_at || new Date().toISOString(),
      }, { onConflict: 'resend_email_id,event_type' });
      if (error) console.error('[logEmailEvent]', error.message);
    },

    async updateSendLogByResendId(resendId, newStatus) {
      // Update send_logs where resend_id matches
      const { error } = await sb.from('send_logs')
        .update({ status: newStatus })
        .eq('resend_id', resendId);
      if (error) console.error('[updateSendLogByResendId]', error.message);
    },

    async getCampaignEvents(campaignId) {
      const { data: logs, error: logErr } = await sb.from('send_logs')
        .select('resend_id, email, level, status')
        .eq('campaign_id', campaignId)
        .not('resend_id', 'is', null);
      if (logErr) throw logErr;

      const resendIds = logs.map(l => l.resend_id).filter(Boolean);
      if (resendIds.length === 0) return { logs, events: [] };

      const allEvents = await this._fetchEventsByResendIds(resendIds);
      return { logs, events: allEvents };
    },

    // Helper: batch fetch events theo danh sách resend_ids
    async _fetchEventsByResendIds(resendIds) {
      let allEvents = [];
      const BATCH = 200;
      for (let i = 0; i < resendIds.length; i += BATCH) {
        const batch = resendIds.slice(i, i + BATCH);
        const { data: events, error } = await sb.from('email_events')
          .select('event_type, resend_email_id, recipient_email')
          .in('resend_email_id', batch);
        if (error) throw error;
        allEvents = allEvents.concat(events || []);
      }
      return allEvents;
    },

    // Helper: tính stats từ events array
    _calcEventStats(events) {
      return {
        delivered: events.filter(e => e.event_type === 'delivered').length,
        opened: new Set(events.filter(e => e.event_type === 'opened').map(e => e.recipient_email)).size,
        clicked: new Set(events.filter(e => e.event_type === 'clicked').map(e => e.recipient_email)).size,
        bounced: events.filter(e => e.event_type === 'bounced').length,
        complained: events.filter(e => e.event_type === 'complained').length,
      };
    },

    async getCampaignTrackingStats(campaignId) {
      const { data: logs, error: logErr } = await sb.from('send_logs')
        .select('resend_id, email, status')
        .eq('campaign_id', campaignId);
      if (logErr) throw logErr;

      const resendIds = (logs || []).map(l => l.resend_id).filter(Boolean);
      const totalSent = (logs || []).filter(l => l.status === 'sent').length;
      const totalFailed = (logs || []).filter(l => l.status === 'failed').length;
      const emptyStats = { total_sent: totalSent, total_failed: totalFailed, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unique_opens: 0, unique_clicks: 0, open_rate: 0, click_rate: 0 };

      if (resendIds.length === 0) return emptyStats;

      const allEvents = await this._fetchEventsByResendIds(resendIds);
      const stats = this._calcEventStats(allEvents);
      const base = totalSent || 1;

      return {
        total_sent: totalSent, total_failed: totalFailed,
        ...stats,
        unique_opens: stats.opened, unique_clicks: stats.clicked,
        open_rate: Math.round((stats.opened / base) * 100),
        click_rate: Math.round((stats.clicked / base) * 100),
      };
    },

    async getTrackingSummary() {
      // 1. Lấy campaigns (1 query)
      const { data: campaigns, error: campErr } = await sb.from('campaigns')
        .select('id, name, status, sent_count, failed_count, sent_at, subject, target_levels')
        .order('created_at', { ascending: false })
        .limit(20);
      if (campErr) throw campErr;
      if (!campaigns?.length) return [];

      const campIds = campaigns.map(c => c.id);

      // 2. Lấy TẤT CẢ send_logs cho campaigns này (1 query, batch nếu >200)
      let allLogs = [];
      const LOG_BATCH = 500;
      for (let i = 0; i < campIds.length; i += LOG_BATCH) {
        const batch = campIds.slice(i, i + LOG_BATCH);
        const { data: logs } = await sb.from('send_logs')
          .select('campaign_id, resend_id')
          .in('campaign_id', batch)
          .not('resend_id', 'is', null);
        allLogs = allLogs.concat(logs || []);
      }

      // Group resend_ids theo campaign
      const logsByCampaign = {};
      for (const log of allLogs) {
        if (!logsByCampaign[log.campaign_id]) logsByCampaign[log.campaign_id] = [];
        logsByCampaign[log.campaign_id].push(log.resend_id);
      }

      // 3. Lấy TẤT CẢ events qua shared helper
      const allResendIds = allLogs.map(l => l.resend_id).filter(Boolean);
      const allEvents = allResendIds.length > 0 ? await this._fetchEventsByResendIds(allResendIds) : [];

      // Group events theo resend_email_id
      const eventsByResendId = {};
      for (const ev of allEvents) {
        if (!eventsByResendId[ev.resend_email_id]) eventsByResendId[ev.resend_email_id] = [];
        eventsByResendId[ev.resend_email_id].push(ev);
      }

      // 4. Aggregate stats cho mỗi campaign (trong memory, không query thêm)
      return campaigns.map(camp => {
        const resendIds = logsByCampaign[camp.id] || [];
        const events = [];
        for (const rid of resendIds) {
          if (eventsByResendId[rid]) events.push(...eventsByResendId[rid]);
        }
        return { ...camp, tracking: this._calcEventStats(events) };
      });
    },

    // ── WORKFLOWS ──────────────────────────────────
    async getWorkflows() {
      const { data, error } = await sb.from('workflows').select('*').order('created_at');
      if (error) throw error;
      return data;
    },
    async createWorkflow({ name, status, nodes }) {
      const { data, error } = await sb.from('workflows')
        .insert({ name, status: status || 'draft', nodes: nodes || [] })
        .select().single();
      if (error) throw error;
      return data;
    },
    async updateWorkflow(id, { name, status, nodes }) {
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (status !== undefined) updates.status = status;
      if (nodes !== undefined) updates.nodes = nodes;
      const { data, error } = await sb.from('workflows')
        .update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async deleteWorkflow(id) {
      const { error } = await sb.from('workflows').delete().eq('id', id);
      if (error) throw error;
    },

    // ── STATS ───────────────────────────────────────
    async getDashStats() {
      const [lv, ca, countMap, totalRes] = await Promise.all([
        sb.from('levels').select('id, name, color, parent_id').order('sort_order'),
        sb.from('campaigns').select('id, name, status, sent_count, failed_count, target_levels, sent_at')
          .order('created_at', { ascending: false }).limit(10),
        this.getContactCountsPerLevel(),
        sb.from('contacts').select('*', { count: 'exact', head: true }),
      ]);
      return {
        levels: lv.data || [],
        countMap,
        totalContacts: totalRes.count || 0,
        recentCampaigns: ca.data || [],
      };
    },
  };
}
