import { makeDB } from '../lib/supabase.js';
import { sendCampaign } from '../lib/email.js';
import { err, allowCors, getDB, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, from_name, from_email, subject, body_text, target_level_ids } = req.body;
  if (!name || !subject || !body_text || !target_level_ids?.length)
    return err(res, 'Thiếu: name, subject, body_text, target_level_ids');

  const db = makeDB(getDB(req));
  const emailConfig = getEmailConfig(req);

  let contacts;
  try { contacts = await db.getContactsByLevelIds(target_level_ids); }
  catch (e) { return err(res, e.message, 500); }

  if (!contacts.length) return err(res, 'Không có contact nào trong các level đã chọn');

  let campaign;
  try {
    campaign = await db.createCampaign({
      name, from_name,
      from_email: from_email || emailConfig.fromEmail,
      subject, body_text, target_levels: target_level_ids, status: 'sending',
    });
  } catch (e) { return err(res, e.message, 500); }

  // Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', total: contacts.length, campaignId: campaign.id });

  try {
    const { sent, failed, results } = await sendCampaign(
      campaign, contacts,
      progress => send({ type: 'progress', ...progress }),
      emailConfig,
    );

    await Promise.all(results.map(r => db.logSend({
      campaign_id: campaign.id, contact_id: r.contact_id,
      email: r.email, level: r.level, status: r.status,
      resend_id: r.resend_id, error_msg: r.error_msg,
    })));

    const sentIds = results.filter(r => r.status === 'sent').map(r => r.contact_id).filter(Boolean);
    if (sentIds.length) await db.markLastSent(sentIds);

    await db.updateCampaignStatus(campaign.id, {
      status: failed === contacts.length ? 'failed' : 'completed',
      sent_count: sent, failed_count: failed,
    });

    send({ type: 'done', sent, failed, total: contacts.length, campaignId: campaign.id });
  } catch (e) {
    await db.updateCampaignStatus(campaign.id, { status: 'failed', sent_count: 0, failed_count: contacts.length });
    send({ type: 'error', error: e.message });
  }
  res.end();
}
