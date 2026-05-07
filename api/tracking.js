import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB, getEmailConfig } from './_utils.js';
import { Resend } from 'resend';

/**
 * Tracking API
 *
 * GET  ?campaign_id=xxx       → Tracking stats cho 1 campaign
 * GET  ?campaign_id=xxx&logs  → Chi tiết event logs
 * GET  ?summary               → Tổng quan tất cả campaigns
 * POST ?backfill=campaign_id  → Lấy trạng thái email cũ từ Resend API và ghi vào email_events
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = makeDB(getDB(req));

    // ── POST: Backfill trạng thái email cũ từ Resend ──
    if (req.method === 'POST') {
      const { backfill } = req.query;
      if (!backfill) return err(res, 'Thiếu backfill=campaign_id');

      const { resendKey } = getEmailConfig(req);
      if (!resendKey) return err(res, 'Chưa cấu hình Resend API Key');

      const resend = new Resend(resendKey);

      // Lấy tất cả send_logs có resend_id cho campaign này
      const { logs } = await db.getCampaignEvents(backfill);
      const withResendId = (logs || []).filter(l => l.resend_id);

      let synced = 0, errors = 0;
      for (const log of withResendId) {
        try {
          // Gọi Resend API để lấy trạng thái email
          const emailData = await resend.emails.get(log.resend_id);

          if (emailData?.data?.last_event) {
            const event = emailData.data.last_event; // delivered, opened, clicked, bounced, complained
            // Ghi event vào email_events (tránh duplicate bằng cách check trước)
            await db.logEmailEvent({
              resend_email_id: log.resend_id,
              event_type: event,
              recipient_email: log.email,
              metadata: { source: 'backfill', raw_status: emailData.data.last_event },
            });
            synced++;
          }
        } catch (e) {
          errors++;
          console.error(`[backfill] Error for ${log.resend_id}:`, e.message);
        }
        // Rate limit: Resend cho phép ~10 req/s
        await new Promise(r => setTimeout(r, 120));
      }

      return ok(res, { total: withResendId.length, synced, errors });
    }

    // ── GET endpoints ──
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { campaign_id, logs, summary } = req.query;

    if (summary !== undefined) {
      const data = await db.getTrackingSummary();
      return ok(res, data);
    }

    if (!campaign_id) return err(res, 'Thiếu campaign_id');

    if (logs !== undefined) {
      const data = await db.getCampaignEvents(campaign_id);
      return ok(res, data);
    }

    const data = await db.getCampaignTrackingStats(campaign_id);
    ok(res, data);
  } catch (e) {
    err(res, e.message, 500);
  }
}
