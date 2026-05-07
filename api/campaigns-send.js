import { sendOneEmail } from '../lib/email.js';
import { ok, err, allowCors, getDBFromReq, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: true } };

/**
 * Cơ chế hoạt động (đơn giản nhất, chắc chắn nhất):
 *
 *  1. Gửi tuần tự từng email — chỉ 1 email tại 1 thời điểm
 *  2. Log ngay sau mỗi email thành công vào send_logs
 *  3. Khi resume: đọc send_logs → loại bỏ email đã gửi → tiếp tục
 *  4. Frontend tự resume khi timeout → gửi liên tục đến hết
 *
 * Đảm bảo: mỗi khách hàng chỉ nhận đúng 1 email cho mỗi campaign
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db          = getDBFromReq(req);
  const emailConfig = getEmailConfig(req);
  const { resume, stop, emergency } = req.query;

  // ── EMERGENCY STOP TOÀN HỆ THỐNG ──
  // GET  ?emergency=status  → kiểm tra trạng thái kill switch
  // POST ?emergency=stop    → khoá hệ thống, dừng tất cả
  // POST ?emergency=resume  → mở khoá
  if (emergency) {
    if (req.method === 'GET' && emergency === 'status') {
      try {
        const active = await db.getKillSwitch();
        return ok(res, { killSwitchActive: active });
      } catch (e) { return err(res, e.message, 500); }
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (emergency === 'stop') {
      try {
        await db.setKillSwitch(true);
        const paused = await db.pauseAllSendingCampaigns();
        return ok(res, { killSwitchActive: true, campaignsPaused: paused });
      } catch (e) { return err(res, e.message, 500); }
    }
    if (emergency === 'resume') {
      try {
        await db.setKillSwitch(false);
        return ok(res, { killSwitchActive: false });
      } catch (e) { return err(res, e.message, 500); }
    }
    return err(res, 'emergency phải là stop|resume|status');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── DỪNG CAMPAIGN ──
  if (stop) {
    try {
      await db.updateCampaignStatus(stop, { status: 'paused' });
      return ok(res, { stopped: true, campaignId: stop });
    } catch (e) { return err(res, e.message, 500); }
  }

  // ── TIẾP TỤC CAMPAIGN ──
  if (resume) return handleResume(req, res, db, emailConfig, resume);

  // ── TẠO CAMPAIGN MỚI ──
  const { name, from_name, from_email, subject, body_text, target_level_ids } = req.body;
  if (!name || !subject || !body_text || !target_level_ids?.length)
    return err(res, 'Thiếu thông tin: name, subject, body_text, target_level_ids');

  // Lấy danh sách contacts
  let contacts;
  try { contacts = await db.getContactsByLevelIds(target_level_ids); }
  catch (e) { return err(res, e.message, 500); }
  if (!contacts.length) return err(res, 'Không có contact nào trong các level đã chọn');

  // Tạo campaign record trong DB
  let campaign;
  try {
    campaign = await db.createCampaign({
      name, from_name,
      from_email:    from_email || emailConfig.fromEmail,
      subject, body_text,
      target_levels: target_level_ids,
      status:        'sending',
    });
  } catch (e) { return err(res, e.message, 500); }

  // Bắt đầu stream SSE
  setupSSE(res);
  const emit = makeEmitter(res);
  emit({ type: 'start', total: contacts.length, campaignId: campaign.id });

  // Gửi tuần tự — chưa có ai được gửi nên sentEmails rỗng
  await sendSequential(campaign, contacts, db, emailConfig, emit, new Set(), contacts.length);
  res.end();
}

// ─────────────────────────────────────────────────────────────────────────────
async function handleResume(req, res, db, emailConfig, campaignId) {
  // 1. Lấy thông tin campaign
  let campaign;
  try {
    const list = await db.getCampaigns();
    campaign = list.find(c => c.id === campaignId);
    if (!campaign) return err(res, 'Campaign không tồn tại');
  } catch (e) { return err(res, 'Lỗi đọc campaign: ' + e.message, 500); }

  // Chặn nếu đang được gửi bởi request khác
  if (campaign.status === 'sending') {
    return err(res,
      'Campaign này đang được gửi. Chờ hoặc bấm Dừng trước.',
      409);
  }

  // 2. Đọc toàn bộ send_logs — lấy TẤT CẢ email đã gửi thành công
  //    Đây là nguồn sự thật duy nhất: ai có trong log với status='sent' → KHÔNG gửi lại
  let sentEmails = new Set();
  try {
    const logs = await db.getCampaignLogs(campaignId);
    for (const log of (logs || [])) {
      if (log.status === 'sent') sentEmails.add(log.email);
    }
  } catch (e) {
    console.warn('[resume] Không đọc được logs, bắt đầu lại từ đầu:', e.message);
    // Vẫn tiếp tục với sentEmails rỗng — an toàn hơn là không gửi gì
  }

  // 3. Lấy toàn bộ contacts của campaign
  let allContacts;
  try {
    allContacts = await db.getContactsByLevelIds(campaign.target_levels || []);
  } catch (e) { return err(res, 'Lỗi đọc contacts: ' + e.message, 500); }

  // 4. Lọc những người CHƯA được gửi
  const remaining = allContacts.filter(c => !sentEmails.has(c.email));

  // Nếu tất cả đã gửi → hoàn thành
  if (!remaining.length) {
    await db.updateCampaignStatus(campaignId, {
      status: 'completed', sent_count: sentEmails.size, failed_count: 0,
    }).catch(() => {});
    return ok(res, {
      message: `Tất cả ${sentEmails.size} email đã được gửi`,
      sent: sentEmails.size,
      remaining: 0,
    });
  }

  // 5. Đánh dấu đang gửi (lock — ngăn request đồng thời)
  try {
    await db.updateCampaignStatus(campaignId, { status: 'sending' });
  } catch (e) { return err(res, 'Không thể bắt đầu: ' + e.message, 500); }

  // 6. Bắt đầu stream và gửi tiếp
  setupSSE(res);
  const emit = makeEmitter(res);
  emit({
    type:        'start',
    total:       allContacts.length,
    alreadySent: sentEmails.size,
    remaining:   remaining.length,
    campaignId,
  });

  await sendSequential(campaign, remaining, db, emailConfig, emit, sentEmails, allContacts.length);
  res.end();
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Gửi TUẦN TỰ từng email — đơn giản, chắc chắn không trùng.
 *
 * sentEmailsSet: Set<email> — những email đã gửi (truyền vào để không gửi lại)
 * Mặc dù đã được lọc trước khi gọi hàm này, Set được truyền vào
 * để phòng trường hợp trùng email trong danh sách contacts.
 */
async function sendSequential(campaign, contacts, db, emailConfig, emit, sentEmailsSet, grandTotal) {
  let sent   = sentEmailsSet.size;
  let failed = 0;
  const justSentIds = [];

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    // Kiểm tra kill switch trước mỗi email (cứ 10 email check 1 lần để tiết kiệm query)
    if (i % 10 === 0) {
      const killed = await db.getKillSwitch().catch(() => false);
      if (killed) {
        console.log('[sendSequential] Kill switch active — dừng gửi');
        await db.updateCampaignStatus(campaign.id, { status: 'paused', sent_count: sent, failed_count: failed }).catch(() => {});
        emit({ type: 'done', sent, failed, total: grandTotal, campaignId: campaign.id, killed: true });
        return;
      }
    }

    // Bảo vệ extra: bỏ qua nếu email này đã được gửi thành công
    if (sentEmailsSet.has(contact.email)) {
      console.log(`[skip] ${contact.email} đã gửi rồi`);
      continue;
    }

    let status = 'failed', resend_id = null, error_msg = null;

    try {
      const result = await sendOneEmail(campaign, contact, emailConfig);
      status    = result.status;
      resend_id = result.resend_id || null;
      error_msg = result.error_msg || null;
    } catch (e) {
      error_msg = e.message;
    }

    // Ghi log NGAY — trước khi tiếp tục sang email sau
    await db.logSend({
      campaign_id: campaign.id,
      contact_id:  contact.id,
      email:       contact.email,
      level:       contact.levels?.name || contact.level || '',
      status, resend_id, error_msg,
    }).catch(e => console.error('[logSend]', e.message));

    if (status === 'sent') {
      sentEmailsSet.add(contact.email); // thêm vào Set để không gửi lại
      justSentIds.push(contact.id);
      sent++;
    } else {
      failed++;
    }

    // Báo tiến trình mỗi email
    emit({
      type:    'progress',
      sent,
      failed,
      total:   grandTotal,
      current: i + 1,
    });
  }

  // Cập nhật last_sent_at
  if (justSentIds.length) {
    await db.markLastSent(justSentIds).catch(e => console.error('[markLastSent]', e.message));
  }

  // Cập nhật trạng thái campaign
  // Các giá trị enum hợp lệ: draft | sending | paused | completed | failed
  const finalStatus =
    sent >= grandTotal ? 'completed' :
    sent  > 0          ? 'paused'    :  // gửi được 1 phần → paused (có thể resume)
                         'failed';

  await db.updateCampaignStatus(campaign.id, {
    status: finalStatus,
    sent_count:   sent,
    failed_count: failed,
  }).catch(e => console.error('[updateStatus]', e.message));

  emit({ type: 'done', sent, failed, total: grandTotal, campaignId: campaign.id });
}

// ─────────────────────────────────────────────────────────────────────────────
function setupSSE(res) {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function makeEmitter(res) {
  return data => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };
}
