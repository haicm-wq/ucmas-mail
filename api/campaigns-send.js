import { makeDB } from '../lib/supabase.js';
import { sendOneEmail } from '../lib/email.js';
import { ok, err, allowCors, getDB, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: true } };

const SEND_DELAY_MS = 150;

/**
 * Campaign Send API — Log ngay mỗi email, chống trùng lặp khi resume
 *
 * POST (no query)              → Tạo campaign mới + bắt đầu gửi
 * POST ?resume=campaign_id     → Gửi tiếp (tự bỏ qua email đã gửi)
 * POST ?stop=campaign_id       → Dừng campaign (đánh dấu partial)
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = makeDB(getDB(req));
  const emailConfig = getEmailConfig(req);
  const { resume, stop } = req.query;

  // ── STOP: Đánh dấu campaign dừng ──
  if (stop) {
    try {
      await db.updateCampaignStatus(stop, { status: 'paused', sent_count: -1, failed_count: 0 });
      return ok(res, { stopped: true, campaignId: stop });
    } catch (e) { return err(res, e.message, 500); }
  }

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
  setupSSE(res);
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'start', total: contacts.length, campaignId: campaign.id });

  await sendAndLog(campaign, contacts, db, emailConfig, send, 0, contacts.length);
  res.end();
}

async function handleResume(req, res, db, emailConfig, campaignId) {
  const campaigns = await db.getCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return err(res, 'Campaign không tồn tại');

  // Lấy danh sách email ĐÃ GỬI THÀNH CÔNG (đã có trong send_logs)
  const logs = await db.getCampaignLogs(campaignId);
  const sentEmails = new Set((logs || []).filter(l => l.status === 'sent').map(l => l.email));

  // Lấy contacts cho campaign
  const allContacts = await db.getContactsByLevelIds(campaign.target_levels || []);
  const remaining = allContacts.filter(c => !sentEmails.has(c.email));

  if (!remaining.length) {
    // Cập nhật status completed nếu chưa
    await db.updateCampaignStatus(campaignId, {
      status: 'completed', sent_count: sentEmails.size, failed_count: 0,
    });
    return ok(res, { message: 'Tất cả email đã được gửi', sent: sentEmails.size, remaining: 0 });
  }

  setupSSE(res);
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({
    type: 'start',
    total: allContacts.length,
    alreadySent: sentEmails.size,
    remaining: remaining.length,
    campaignId,
  });

  await sendAndLog(campaign, remaining, db, emailConfig, send, sentEmails.size, allContacts.length);
  res.end();
}

/**
 * Gửi email + LOG NGAY từng cái → chống mất dữ liệu khi timeout
 */
async function sendAndLog(campaign, contacts, db, emailConfig, send, alreadySent, grandTotal) {
  let sent = alreadySent, failed = 0;
  let batchSentIds = [];

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    try {
      const result = await sendOneEmail(campaign, contact, emailConfig);

      // LOG NGAY — không đợi cuối batch
      try {
        await db.logSend({
          campaign_id: campaign.id, contact_id: contact.id,
          email: contact.email,
          level: contact.levels?.name || contact.level || '',
          status: result.status,
          resend_id: result.resend_id, error_msg: result.error_msg,
        });
      } catch (logErr) { console.error('[logSend]', logErr.message); }

      if (result.status === 'sent') {
        sent++;
        batchSentIds.push(contact.id);
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      try {
        await db.logSend({
          campaign_id: campaign.id, contact_id: contact.id,
          email: contact.email,
          level: contact.levels?.name || contact.level || '',
          status: 'failed', error_msg: e.message,
        });
      } catch (logErr) { console.error('[logSend]', logErr.message); }
    }

    // Thông báo tiến trình mỗi 10 email hoặc email cuối
    if ((i + 1) % 10 === 0 || i === contacts.length - 1) {
      send({ type: 'progress', sent, failed, total: grandTotal, current: i + 1, batchSize: contacts.length });
    }

    await sleep(SEND_DELAY_MS);
  }

  // Cập nhật last_sent_at cho contacts
  if (batchSentIds.length) {
    try { await db.markLastSent(batchSentIds); } catch (e) { console.error('[markLastSent]', e.message); }
  }

  // Cập nhật status campaign
  const finalStatus = sent >= grandTotal ? 'completed' : (sent > alreadySent ? 'partial' : 'failed');
  await db.updateCampaignStatus(campaign.id, {
    status: finalStatus, sent_count: sent, failed_count: failed,
  });

  send({ type: 'done', sent, failed, total: grandTotal, campaignId: campaign.id });
}

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
