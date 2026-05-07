import { makeDB } from '../lib/supabase.js';
import { sendCampaign } from '../lib/email.js';
import { ok, err, allowCors, getDB, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: true } };

/**
 * Campaign Send API — Hỗ trợ batch sending cho danh sách lớn
 *
 * POST (no query)              → Tạo campaign + gửi batch đầu tiên (SSE stream)
 * POST ?resume=campaign_id     → Resume gửi tiếp các email chưa gửi
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = makeDB(getDB(req));
  const emailConfig = getEmailConfig(req);
  const { resume } = req.query;

  // ── RESUME: Gửi tiếp campaign bị dở ──
  if (resume) {
    return handleResume(req, res, db, emailConfig, resume);
  }

  // ── NEW CAMPAIGN ──
  const { name, from_name, from_email, subject, body_text, target_level_ids } = req.body;
  if (!name || !subject || !body_text || !target_level_ids?.length)
    return err(res, 'Thiếu: name, subject, body_text, target_level_ids');

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

  // SSE stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'start', total: contacts.length, campaignId: campaign.id });

  await sendBatch(campaign, contacts, db, emailConfig, send, 0);
  res.end();
}

async function handleResume(req, res, db, emailConfig, campaignId) {
  // Lấy campaign info
  const campaigns = await db.getCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return err(res, 'Campaign không tồn tại');

  // Lấy danh sách email đã gửi
  const logs = await db.getCampaignLogs(campaignId);
  const sentEmails = new Set((logs || []).map(l => l.email));

  // Lấy contacts cho campaign này
  const contacts = await db.getContactsByLevelIds(campaign.target_levels || campaign.target_level_ids || []);
  const remaining = contacts.filter(c => !sentEmails.has(c.email));

  if (!remaining.length) {
    return ok(res, { message: 'Tất cả email đã được gửi', sent: sentEmails.size, remaining: 0 });
  }

  // SSE stream
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'start', total: contacts.length, alreadySent: sentEmails.size, remaining: remaining.length, campaignId });

  await sendBatch(campaign, remaining, db, emailConfig, send, sentEmails.size);
  res.end();
}

// Gửi theo batch, log ngay mỗi email, cập nhật campaign status liên tục
async function sendBatch(campaign, contacts, db, emailConfig, send, alreadySent) {
  let sent = alreadySent, failed = 0;
  const total = alreadySent + contacts.length;

  try {
    const { sent: batchSent, failed: batchFailed, results } = await sendCampaign(
      campaign, contacts,
      progress => send({ type: 'progress', sent: alreadySent + progress.sent, failed: progress.failed, total }),
      emailConfig,
    );

    // Log mỗi kết quả ngay (từng cái)
    for (const r of results) {
      try {
        await db.logSend({
          campaign_id: campaign.id, contact_id: r.contact_id,
          email: r.email, level: r.level, status: r.status,
          resend_id: r.resend_id, error_msg: r.error_msg,
        });
      } catch (e) { console.error('[logSend error]', e.message); }
    }

    sent += batchSent;
    failed += batchFailed;

    const sentIds = results.filter(r => r.status === 'sent').map(r => r.contact_id).filter(Boolean);
    if (sentIds.length) await db.markLastSent(sentIds);

    await db.updateCampaignStatus(campaign.id, {
      status: failed === contacts.length ? 'failed' : sent >= total ? 'completed' : 'partial',
      sent_count: sent, failed_count: failed,
    });

    send({ type: 'done', sent, failed, total, campaignId: campaign.id });
  } catch (e) {
    // Timeout hoặc lỗi — lưu status partial để có thể resume
    await db.updateCampaignStatus(campaign.id, {
      status: 'partial', sent_count: sent, failed_count: failed,
    });
    send({ type: 'error', error: e.message, sent, failed, total, resumable: true, campaignId: campaign.id });
  }
}
