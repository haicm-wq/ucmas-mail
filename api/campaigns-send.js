import { sendOneEmail } from '../lib/email.js';
import { ok, err, allowCors, getDBFromReq, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: true } };

/**
 * Gửi tuần tự từng email một — LOG ngay trước khi gửi email tiếp theo.
 * Khi Vercel timeout, connection ngắt → frontend phát hiện → tự resume.
 * Backend resume đọc send_logs → bỏ qua email đã gửi → tiếp tục từ chỗ dừng.
 *
 * POST (no query)              → Tạo campaign mới + bắt đầu gửi
 * POST ?resume=campaign_id     → Gửi tiếp từ email chưa gửi
 * POST ?stop=campaign_id       → Dừng campaign (đánh dấu paused)
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db          = getDBFromReq(req);
  const emailConfig = getEmailConfig(req);
  const { resume, stop } = req.query;

  // ── STOP ──
  if (stop) {
    try {
      await db.updateCampaignStatus(stop, { status: 'paused' });
      return ok(res, { stopped: true, campaignId: stop });
    } catch (e) { return err(res, e.message, 500); }
  }

  // ── RESUME ──
  if (resume) return handleResume(req, res, db, emailConfig, resume);

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
      subject, body_text,
      target_levels: target_level_ids,
      status: 'sending',
    });
  } catch (e) { return err(res, e.message, 500); }

  setupSSE(res);
  const emit = makeEmitter(res);

  emit({ type: 'start', total: contacts.length, campaignId: campaign.id });
  await sendSequential(campaign, contacts, db, emailConfig, emit, 0, contacts.length);
  res.end();
}

// ─────────────────────────────────────────────────────────
async function handleResume(req, res, db, emailConfig, campaignId) {
  let campaign;
  try {
    const list = await db.getCampaigns();
    campaign = list.find(c => c.id === campaignId);
    if (!campaign) return err(res, 'Campaign không tồn tại');
  } catch (e) { return err(res, 'Lỗi đọc campaign: ' + e.message, 500); }

  // Chặn resume khi campaign đang được gửi bởi tiến trình khác
  if (campaign.status === 'sending') {
    return err(res,
      'Campaign đang được gửi bởi tiến trình khác. Chờ hoặc bấm Dừng trước.',
      409);
  }

  // Đọc danh sách email đã gửi thành công
  let sentEmails = new Set();
  try {
    const logs = await db.getCampaignLogs(campaignId);
    sentEmails = new Set(
      (logs || []).filter(l => l.status === 'sent').map(l => l.email)
    );
  } catch (e) {
    console.warn('[resume] Không đọc được logs, bắt đầu từ đầu:', e.message);
  }

  // Lấy toàn bộ contacts của campaign
  let allContacts = [];
  try {
    allContacts = await db.getContactsByLevelIds(campaign.target_levels || []);
  } catch (e) { return err(res, 'Lỗi đọc contacts: ' + e.message, 500); }

  // Lọc ra những email CHƯA gửi
  const remaining = allContacts.filter(c => !sentEmails.has(c.email));

  if (!remaining.length) {
    await db.updateCampaignStatus(campaignId, {
      status: 'completed', sent_count: sentEmails.size, failed_count: 0,
    }).catch(() => {});
    return ok(res, {
      message: 'Tất cả email đã được gửi',
      sent: sentEmails.size, remaining: 0,
    });
  }

  // Đánh dấu đang gửi (lock — chặn resume đồng thời)
  try {
    await db.updateCampaignStatus(campaignId, { status: 'sending' });
  } catch (e) { return err(res, 'Không thể khóa campaign: ' + e.message, 500); }

  setupSSE(res);
  const emit = makeEmitter(res);

  emit({
    type: 'start',
    total:      allContacts.length,
    alreadySent: sentEmails.size,
    remaining:  remaining.length,
    campaignId,
  });

  await sendSequential(campaign, remaining, db, emailConfig, emit, sentEmails.size, allContacts.length);
  res.end();
}

// ─────────────────────────────────────────────────────────
/**
 * Gửi TUẦN TỰ từng email một.
 * Không có parallel — đơn giản, dễ resume, không gửi trùng.
 *
 * Khi Vercel timeout, hàm này bị interrupt tự nhiên.
 * Vì email đã được log ngay sau khi gửi xong, resume lần sau
 * sẽ bỏ qua đúng những email đó và tiếp tục từ chỗ dừng.
 */
async function sendSequential(campaign, contacts, db, emailConfig, emit, alreadySent, grandTotal) {
  let sent   = alreadySent;
  let failed = 0;
  const batchSentIds = [];

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    try {
      const result = await sendOneEmail(campaign, contact, emailConfig);

      // Log NGAY — trước khi gửi email tiếp theo
      await db.logSend({
        campaign_id: campaign.id,
        contact_id:  contact.id,
        email:       contact.email,
        level:       contact.levels?.name || contact.level || '',
        status:      result.status,
        resend_id:   result.resend_id  || null,
        error_msg:   result.error_msg  || null,
      }).catch(e => console.error('[logSend]', e.message));

      if (result.status === 'sent') {
        sent++;
        batchSentIds.push(contact.id);
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
      await db.logSend({
        campaign_id: campaign.id,
        contact_id:  contact.id,
        email:       contact.email,
        level:       contact.levels?.name || contact.level || '',
        status:      'failed',
        error_msg:   e.message,
      }).catch(() => {});
    }

    // Emit tiến trình mỗi email
    emit({
      type:    'progress',
      sent,
      failed,
      total:   grandTotal,
      current: i + 1,
    });
  }

  // Cập nhật last_sent_at
  if (batchSentIds.length) {
    await db.markLastSent(batchSentIds).catch(e => console.error('[markLastSent]', e.message));
  }

  // Cập nhật trạng thái campaign
  const finalStatus = sent >= grandTotal ? 'completed'
    : sent > alreadySent                 ? 'partial'
    :                                      'failed';

  await db.updateCampaignStatus(campaign.id, {
    status: finalStatus, sent_count: sent, failed_count: failed,
  }).catch(e => console.error('[updateStatus]', e.message));

  emit({ type: 'done', sent, failed, total: grandTotal, campaignId: campaign.id });
}

// ─────────────────────────────────────────────────────────
function setupSSE(res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function makeEmitter(res) {
  return data => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };
}
