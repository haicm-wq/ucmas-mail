import { sendTestEmail } from '../lib/email.js';
import { ok, err, allowCors, getEmailConfig } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { to, subject, body_text, from_name } = req.body;
    if (!to || !subject || !body_text) return err(res, 'Thiếu to, subject hoặc body_text');
    ok(res, await sendTestEmail({ to, subject, body_text, from_name }, getEmailConfig(req)));
  } catch (e) { err(res, e.message); }
}
