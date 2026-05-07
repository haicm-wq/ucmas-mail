import { sendTestEmail } from '../lib/email.js';
import { ok, err, allowCors, getDBFromReq, getEmailConfig } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // --- TEST EMAIL (POST ?action=test) ---
  if (req.method === 'POST' && action === 'test') {
    try {
      const { to, subject, body_text, from_name } = req.body;
      if (!to || !subject || !body_text) return err(res, 'Thiếu to, subject hoặc body_text');
      ok(res, await sendTestEmail({ to, subject, body_text, from_name }, getEmailConfig(req)));
    } catch (e) { err(res, e.message); }

  // --- GET CAMPAIGNS / HISTORY ---
  } else if (req.method === 'GET') {
    try {
      const db = getDBFromReq(req);
      if (req.query.contact_email) {
        ok(res, await db.getContactEmailHistory(req.query.contact_email));
      } else if (req.query.logs) {
        ok(res, await db.getCampaignLogs(req.query.logs));
      } else {
        ok(res, await db.getCampaigns());
      }
    } catch (e) { err(res, e.message, 500); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
