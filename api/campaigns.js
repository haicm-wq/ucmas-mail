import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = makeDB(getDB(req));
    if (req.query.contact_email) {
      ok(res, await db.getContactEmailHistory(req.query.contact_email));
    } else if (req.query.logs) {
      ok(res, await db.getCampaignLogs(req.query.logs));
    } else {
      ok(res, await db.getCampaigns());
    }
  } catch (e) { err(res, e.message, 500); }
}
