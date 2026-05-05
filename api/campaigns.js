import { getCampaigns, getCampaignLogs } from '../lib/supabase.js';
import { ok, err, allowCors } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      // GET /api/campaigns?logs=<campaignId> → trả về logs
      if (req.query.logs) {
        ok(res, await getCampaignLogs(req.query.logs));
      } else {
        ok(res, await getCampaigns());
      }
    } catch (e) { err(res, e.message, 500); }

  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
