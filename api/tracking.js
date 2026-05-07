import { ok, err, allowCors, getDBFromReq, getEmailConfig } from './_utils.js';
import { getResend } from '../lib/email.js';

const RATE_LIMIT_MS = 120;

/**
 * Tracking API
 *
 * GET  ?campaign_id=xxx       → Tracking stats cho 1 campaign
 * GET  ?campaign_id=xxx&logs  → Chi tiết event logs
 * GET  ?summary               → Tổng quan tất cả campaigns
 * POST ?backfill=campaign_id  → Đồng bộ từ Resend: tìm email theo subject, tạo send_logs + events
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = getDBFromReq(req);

    // ── POST: Backfill từ Resend ──
    if (req.method === 'POST') {
      const { backfill } = req.query;
      if (!backfill) return err(res, 'Thiếu backfill=campaign_id');

      const { resendKey } = getEmailConfig(req);
      if (!resendKey) return err(res, 'Chưa cấu hình Resend API Key');

      return await handleBackfill(res, db, getResend(resendKey), backfill);
    }

    // ── GET endpoints ──
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { campaign_id, logs, summary } = req.query;

    if (summary !== undefined) return ok(res, await db.getTrackingSummary());
    if (!campaign_id) return err(res, 'Thiếu campaign_id');
    if (logs !== undefined) return ok(res, await db.getCampaignEvents(campaign_id));
    return ok(res, await db.getCampaignTrackingStats(campaign_id));

  } catch (e) { err(res, e.message, 500); }
}

/**
 * Backfill thông minh:
 * 1. Nếu campaign CÓ send_logs (có resend_id) → fetch trạng thái từng email từ Resend
 * 2. Nếu campaign KHÔNG CÓ send_logs → tìm trên Resend bằng subject, tạo send_logs mới
 */
async function handleBackfill(res, db, resend, campaignId) {
  // Lấy campaign info
  const campaigns = await db.getCampaigns();
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return err(res, 'Campaign không tồn tại');

  // Lấy send_logs hiện tại
  const existingLogs = await db.getCampaignLogs(campaignId);
  const logsWithResendId = (existingLogs || []).filter(l => l.resend_id);

  // ── CASE 1: Đã có send_logs → chỉ cần update trạng thái ──
  if (logsWithResendId.length > 0) {
    return await backfillFromExistingLogs(res, db, resend, logsWithResendId);
  }

  // ── CASE 2: KHÔNG có send_logs → tìm trên Resend bằng subject ──
  return await backfillBySearching(res, db, resend, campaign, campaignId);
}

/**
 * Case 1: Đã có send_logs → fetch trạng thái từ Resend API
 */
async function backfillFromExistingLogs(res, db, resend, logs) {
  let synced = 0, errors = 0;
  for (const log of logs) {
    try {
      const emailData = await resend.emails.get(log.resend_id);
      if (emailData?.data?.last_event) {
        await db.logEmailEvent({
          resend_email_id: log.resend_id,
          event_type: emailData.data.last_event,
          recipient_email: log.email,
          metadata: { source: 'backfill' },
        });
        synced++;
      }
    } catch (e) {
      errors++;
      console.error(`[backfill] ${log.resend_id}:`, e.message);
    }
    await sleep(RATE_LIMIT_MS);
  }
  return ok(res, { mode: 'existing_logs', total: logs.length, synced, errors });
}

/**
 * Case 2: Không có send_logs → List emails từ Resend, match theo subject
 * Tạo send_logs mới + ghi events
 */
async function backfillBySearching(res, db, resend, campaign, campaignId) {
  const subject = campaign.subject || '';
  const campaignFrom = campaign.from_email || '';

  // Lấy contacts cho campaign này (để lọc theo email)
  let campaignContacts = [];
  if (campaign.target_levels?.length) {
    try { campaignContacts = await db.getContactsByLevelIds(campaign.target_levels); }
    catch (e) { /* ignore */ }
  }
  const contactEmails = new Set(campaignContacts.map(c => c.email?.toLowerCase()));

  // List emails từ Resend API — lấy tối đa 3000 email gần nhất
  const allEmails = [];
  let lastId = undefined;
  const MAX_PAGES = 30;
  let totalScanned = 0;
  let sampleSubjects = []; // debug: lưu vài subject đầu để so sánh

  // Normalize: loại tất cả emoji, lowercase, trim
  const stripEmoji = s => (s || '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
  const normalize = s => stripEmoji(s).toLowerCase().replace(/\s+/g, ' ');
  
  // Lấy vài từ đầu tiên của subject (trước {{ hoặc emoji)
  const subjectClean = normalize(subject);
  const subjectWords = subjectClean.split(' ').filter(w => w.length > 1).slice(0, 4).join(' ');

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = { limit: 100 };
      if (lastId) params.after = lastId;
      const { data: result } = await resend.emails.list(params);
      const emails = result?.data || [];
      if (!emails.length) break;
      totalScanned += emails.length;

      // Debug: lưu mẫu 3 subject đầu tiên
      if (sampleSubjects.length < 3) {
        emails.slice(0, 3).forEach(e => sampleSubjects.push(e.subject));
      }

      for (const email of emails) {
        const emailSubjectClean = normalize(email.subject);
        const emailTo = email.to?.[0]?.toLowerCase() || '';

        // Match nếu:
        // 1. Subject normalized giống nhau (chính xác)
        // 2. Subject chứa vài từ đầu (khi có emoji/variable)
        // 3. Recipient nằm trong contact list CỦA campaign
        const subjectMatch = emailSubjectClean === subjectClean
          || (subjectWords.length >= 5 && emailSubjectClean.includes(subjectWords));
        const recipientMatch = contactEmails.size > 0 && contactEmails.has(emailTo);

        if (subjectMatch || recipientMatch) {
          allEmails.push(email);
        }
      }

      lastId = emails[emails.length - 1]?.id;
      if (emails.length < 100) break;
      await sleep(RATE_LIMIT_MS);
    } catch (e) {
      console.error('[backfill search page]', e.message);
      break;
    }
  }

  if (!allEmails.length) {
    return ok(res, {
      mode: 'search', found: 0, scanned: totalScanned,
      contactsInCampaign: contactEmails.size,
      subjectTemplate: subject,
      subjectNormalized: subjectClean,
      subjectWords,
      sampleSubjectsFromResend: sampleSubjects,
      message: `Không tìm thấy email nào khớp. Đã quét ${totalScanned} email trên Resend.`
    });
  }

  // Loại bỏ duplicate (cùng recipient, giữ email đầu tiên)
  const seenRecipients = new Set();
  const uniqueEmails = [];
  for (const email of allEmails) {
    const to = email.to?.[0] || '';
    if (!seenRecipients.has(to)) {
      seenRecipients.add(to);
      uniqueEmails.push(email);
    }
  }

  // Lấy contacts để map email → contact_id
  // Dùng contacts đã fetch ở trên — không fetch lại lần 2
  const contactMap = {};
  campaignContacts.forEach(c => { contactMap[c.email] = c; });

  // Tạo send_logs + events cho từng email tìm được
  let created = 0, eventsCreated = 0, errors = 0;
  for (const email of uniqueEmails) {
    const to = email.to?.[0] || '';
    const contact = contactMap[to];
    try {
      // Tạo send_log
      await db.logSend({
        campaign_id: campaignId,
        contact_id: contact?.id || null,
        email: to,
        level: contact?.levels?.name || '',
        status: 'sent',
        resend_id: email.id,
      });
      created++;

      // Fetch chi tiết trạng thái và ghi event
      try {
        const detail = await resend.emails.get(email.id);
        if (detail?.data?.last_event) {
          await db.logEmailEvent({
            resend_email_id: email.id,
            event_type: detail.data.last_event,
            recipient_email: to,
            metadata: { source: 'backfill_search' },
          });
          eventsCreated++;
        }
      } catch (e) { /* skip event if fetch fails */ }

      await sleep(RATE_LIMIT_MS);
    } catch (e) {
      errors++;
      console.error(`[backfill create]`, e.message);
    }
  }

  // Cập nhật campaign status
  await db.updateCampaignStatus(campaignId, {
    status: 'completed', sent_count: created, failed_count: 0,
  });

  return ok(res, {
    mode: 'search',
    found: allEmails.length,
    unique: uniqueEmails.length,
    duplicates: allEmails.length - uniqueEmails.length,
    send_logs_created: created,
    events_created: eventsCreated,
    errors,
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
