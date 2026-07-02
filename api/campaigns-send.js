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
      status:        req.query.save_draft ? 'paused' : 'sending',
    });
  } catch (e) { return err(res, e.message, 500); }

  if (req.query.save_draft) {
      return ok(res, { saved: true, campaignId: campaign.id, total: contacts.length });
  }

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
  // 1. Kiểm tra trạng thái campaign (nhẹ, không gọi getCampaigns nặng)
  let campStatus;
  try {
    campStatus = await db.getCampaignStatus(campaignId);
    if (!campStatus) return err(res, 'Campaign không tồn tại');
  } catch (e) { return err(res, 'Lỗi đọc campaign: ' + e.message, 500); }

  // Chặn nếu đang được gửi bởi request khác
  if (campStatus === 'sending') {
    return err(res, 'Campaign này đang được gửi. Chờ hoặc bấm Dừng trước.', 409);
  }

  // Lấy thông tin campaign đầy đủ (nhẹ, chỉ 1 record)
  let campaign;
  try {
    const { data, error: cErr } = await db._sb().from('campaigns')
      .select('*').eq('id', campaignId).maybeSingle();
    if (cErr) throw cErr;
    campaign = data;
    if (!campaign) return err(res, 'Campaign không tồn tại');
  } catch (e) { return err(res, 'Lỗi đọc campaign: ' + e.message, 500); }

  // 2. Đọc toàn bộ send_logs — lấy TẤT CẢ email đã được xử lý (sent HOẶC failed)
  //    Email failed vẫn có thể đã được Resend gửi thành công → không gửi lại
  let sentEmails = new Set();
  try {
    const logs = await db.getCampaignLogs(campaignId);
    for (const log of (logs || [])) {
      // Thêm TẤT CẢ email đã xử lý vào Set (không chỉ 'sent')
      sentEmails.add(log.email);
    }
  } catch (e) {
    console.warn('[resume] Không đọc được logs:', e.message);
    // QUAN TRỌNG: Nếu không đọc được logs, DỪNG LẠI để tránh gửi trùng
    return err(res, 'Không đọc được send_logs. Thử lại sau.', 500);
  }

  // 3. Lấy toàn bộ contacts của campaign
  let allContacts;
  try {
    allContacts = await db.getContactsByLevelIds(campaign.target_levels || []);
  } catch (e) { return err(res, 'Lỗi đọc contacts: ' + e.message, 500); }

  // 4. Lọc những người CHƯA được gửi (không có trong send_logs)
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

  // 5. Đánh dấu đang gửi (lock) — kiểm tra lại trước khi lock (tránh race condition)
  try {
    const recheck = await db.getCampaignStatus(campaignId);
    if (recheck === 'sending') {
      return err(res, 'Campaign vừa được bắt đầu bởi request khác.', 409);
    }
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

    // Kiểm tra kill switch + campaign status mỗi 5 email
    if (i % 5 === 0) {
      const killed = await db.getKillSwitch().catch(() => false);
      if (killed) {
        console.log('[sendSequential] Kill switch active — dừng gửi');
        await db.updateCampaignStatus(campaign.id, { status: 'paused', sent_count: sent, failed_count: failed }).catch(() => {});
        emit({ type: 'done', sent, failed, total: grandTotal, campaignId: campaign.id, killed: true });
        return;
      }
      // Kiểm tra campaign đã bị dừng từ frontend chưa
      const campStatus = await db.getCampaignStatus(campaign.id).catch(() => null);
      if (campStatus === 'paused') {
        console.log('[sendSequential] Campaign paused by user — dừng gửi');
        emit({ type: 'done', sent, failed, total: grandTotal, campaignId: campaign.id, paused: true });
        return;
      }
    }

    // Bảo vệ extra: bỏ qua nếu email này đã được xử lý (sent hoặc failed)
    if (sentEmailsSet.has(contact.email)) {
      console.log(`[skip] ${contact.email} đã có trong logs`);
      continue;
    }

    // Kiểm tra lần cuối trước khi gửi: query DB để chắc chắn chưa gửi
    try {
      const { data: existLog } = await db._sb().from('send_logs')
        .select('id').eq('campaign_id', campaign.id).eq('email', contact.email).limit(1);
      if (existLog?.length) {
        console.log(`[skip-db] ${contact.email} đã có log trong DB`);
        sentEmailsSet.add(contact.email);
        continue;
      }
    } catch (_) { /* bỏ qua lỗi query, tiếp tục gửi */ }

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

    // Lưu tiến trình mỗi 10 email — phòng mất kết nối
    if ((sent + failed) % 10 === 0 && (sent + failed) > 0) {
      await db.updateCampaignStatus(campaign.id, {
        status: 'sending', sent_count: sent, failed_count: failed,
      }).catch(() => {});
    }
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
