import { sendOneEmail } from '../lib/email.js';
import { ok, err, allowCors, getDBFromReq, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: true } };

const BATCH_SIZE  = 2;   // Giảm xuống 2 để an toàn hơn
const BATCH_DELAY = 100; // ms chờ giữa các batch

/**
 * Campaign Send API
 *
 * POST (no query)              → Tạo campaign mới + bắt đầu gửi
 * POST ?resume=campaign_id     → Gửi tiếp (tự bỏ qua email đã gửi)
 * POST ?stop=campaign_id       → Dừng campaign
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDBFromReq(req);
  const emailConfig = getEmailConfig(req);
  const { resume, stop } = req.query;

  // ── STOP ──
  if (stop) {
    try {
      await db.updateCampaignStatus(stop, { status: 'paused', sent_count: -1, failed_count: 0 });
      return ok(res, { stopped: true, campaignId: stop });
    } catch (e) { return err(res, e.message, 500); }
  }

  // ── RESUME ──
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

  setupSSE(res);
  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', total: contacts.length, campaignId: campaign.id });

  await sendAndLog(campaign, contacts, db, emailConfig, send, 0, contacts.length);
  res.end();
}

async function handleResume(req, res, db, emailConfig, campaignId) {
  let campaign;
  try {
    const campaigns = await db.getCampaigns();
    campaign = campaigns.find(c => c.id === campaignId);
    if (!campaign) return err(res, 'Campaign không tồn tại');
  } catch (e) { return err(res, 'Lỗi đọc campaign: ' + e.message, 500); }

  // ✅ FIX #1: Chặn resume nếu campaign đang được gửi bởi tiến trình khác
  if (campaign.status === 'sending') {
    return err(res, 'Campaign đang được gửi bởi tiến trình khác. Vui lòng chờ hoặc bấm Dừng trước.', 409);
  }

  // ✅ FIX #2: Đánh dấu sending ngay để chặn request đồng thời
  try {
    await db.updateCampaignStatus(campaignId, { status: 'sending' });
  } catch (e) {
    return err(res, 'Không thể khóa campaign: ' + e.message, 500);
  }

  let sentEmails = new Set();
  try {
    const logs = await db.getCampaignLogs(campaignId);
    // ✅ FIX #3: Lọc theo CẢ 'sent' để không gửi lại email đã thành công
    sentEmails = new Set((logs || []).filter(l => l.status === 'sent').map(l => l.email));
  } catch (e) {
    console.warn('[handleResume] Không đọc được send_logs, resume từ đầu:', e.message);
  }

  let allContacts = [];
  try {
    allContacts = await db.getContactsByLevelIds(campaign.target_levels || []);
  } catch (e) {
    // Rollback status nếu lỗi
    await db.updateCampaignStatus(campaignId, { status: 'paused' }).catch(() => {});
    return err(res, 'Lỗi đọc contacts: ' + e.message, 500);
  }

  const remaining = allContacts.filter(c => !sentEmails.has(c.email));

  if (!remaining.length) {
    try {
      await db.updateCampaignStatus(campaignId, {
        status: 'completed', sent_count: sentEmails.size, failed_count: 0,
      });
    } catch (e) { console.warn('[handleResume] Không cập nhật được status:', e.message); }
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
 * Gửi email theo batch nhỏ — log ngay từng cái
 * ✅ FIX: Kiểm tra send_logs trước mỗi email để chặn gửi trùng
 */
async function sendAndLog(campaign, contacts, db, emailConfig, send, alreadySent, grandTotal) {
  let sent = alreadySent, failed = 0;
  let batchSentIds = [];
  let processed = 0;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);

    // Gửi batch song song
    const results = await Promise.allSettled(
      batch.map(contact => sendOneEmail(campaign, contact, emailConfig))
    );

    // Log kết quả
    const logPromises = results.map(async (result, j) => {
      const contact = batch[j];
      let status, resend_id, error_msg;

      if (result.status === 'fulfilled') {
        status    = result.value.status;
        resend_id = result.value.resend_id;
        error_msg = result.value.error_msg;
      } else {
        status    = 'failed';
        error_msg = result.reason?.message || 'Unknown error';
      }

      if (status === 'sent') {
        sent++;
        batchSentIds.push(contact.id);
      } else {
        failed++;
      }

      try {
        await db.logSend({
          campaign_id: campaign.id,
          contact_id:  contact.id,
          email:       contact.email,
          level:       contact.levels?.name || contact.level || '',
          status, resend_id, error_msg,
        });
      } catch (logErr) { console.error('[logSend]', logErr.message); }
    });

    await Promise.all(logPromises);
    processed += batch.length;

    send({
      type: 'progress',
      sent, failed,
      total: grandTotal,
      current: processed,
      batchSize: contacts.length,
    });

    if (i + BATCH_SIZE < contacts.length) {
      await sleep(BATCH_DELAY);
    }
  }

  if (batchSentIds.length) {
    try { await db.markLastSent(batchSentIds); } catch (e) { console.error('[markLastSent]', e.message); }
  }

  const finalStatus = sent >= grandTotal
    ? 'completed'
    : (sent > alreadySent ? 'partial' : 'failed');

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
