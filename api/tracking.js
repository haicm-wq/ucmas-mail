import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

/**
 * Tracking API — Lấy dữ liệu tracking cho campaigns
 *
 * GET ?campaign_id=xxx       → Lấy tracking stats cho 1 campaign
 * GET ?campaign_id=xxx&logs  → Lấy chi tiết event logs cho 1 campaign
 * GET ?summary               → Lấy tổng quan tracking cho tất cả campaigns gần đây
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = makeDB(getDB(req));
    const { campaign_id, logs, summary } = req.query;

    if (summary !== undefined) {
      // Tổng quan tracking cho tất cả campaigns
      const data = await db.getTrackingSummary();
      return ok(res, data);
    }

    if (!campaign_id) return err(res, 'Thiếu campaign_id');

    if (logs !== undefined) {
      // Chi tiết event logs
      const data = await db.getCampaignEvents(campaign_id);
      return ok(res, data);
    }

    // Tracking stats cho 1 campaign
    const data = await db.getCampaignTrackingStats(campaign_id);
    ok(res, data);
  } catch (e) {
    err(res, e.message, 500);
  }
}
