import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import * as db from './lib/supabase.js';
import { sendCampaign, sendTestEmail } from './lib/email.js';
import { parseContactFile } from './lib/csvParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // phục vụ ucmas-mail.html

// Multer: lưu file upload tạm vào /tmp
const upload = multer({
  dest: path.join(__dirname, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ─── Helpers ──────────────────────────────────────────
function ok(res, data)  { res.json({ success: true,  data }); }
function err(res, msg, status = 400) {
  console.error('[API Error]', msg);
  res.status(status).json({ success: false, error: String(msg) });
}

// ════════════════════════════════════════
// LEVELS
// ════════════════════════════════════════

app.get('/api/levels', async (req, res) => {
  try {
    const levels = await db.getLevels();
    // Đếm số contacts mỗi level
    const contacts = await db.getContacts();
    const countMap = {};
    contacts.forEach(c => {
      if (c.level_id) countMap[c.level_id] = (countMap[c.level_id] || 0) + 1;
    });
    const result = levels.map(l => ({ ...l, count: countMap[l.id] || 0 }));
    ok(res, result);
  } catch (e) { err(res, e.message, 500); }
});

app.post('/api/levels', async (req, res) => {
  try {
    const { name, color, parent_id, description, sort_order } = req.body;
    if (!name) return err(res, 'Tên level là bắt buộc');
    const level = await db.createLevel({ name, color: color || '#5ba8ff', parent_id, description, sort_order });
    ok(res, level);
  } catch (e) { err(res, e.message); }
});

app.delete('/api/levels/:id', async (req, res) => {
  try {
    await db.deleteLevel(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e.message); }
});

// ════════════════════════════════════════
// CONTACTS
// ════════════════════════════════════════

app.get('/api/contacts', async (req, res) => {
  try {
    const { levelId, search, status } = req.query;
    const contacts = await db.getContacts({ levelId, search, status });
    ok(res, contacts);
  } catch (e) { err(res, e.message, 500); }
});

app.patch('/api/contacts/:id/level', async (req, res) => {
  try {
    const { levelId } = req.body;
    if (!levelId) return err(res, 'levelId là bắt buộc');
    await db.updateContactLevel(req.params.id, levelId);
    ok(res, { updated: true });
  } catch (e) { err(res, e.message); }
});

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    await db.deleteContact(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e.message); }
});

// Import CSV/Excel
app.post('/api/contacts/import', upload.single('file'), async (req, res) => {
  if (!req.file) return err(res, 'Không có file được tải lên');

  try {
    const { rows, errors } = parseContactFile(req.file.path, req.file.mimetype);

    if (rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return err(res, errors.join('; '));
    }

    // Lấy tất cả levels để resolve tên → uuid
    const levels = await db.getLevels();
    const levelMap = {};
    levels.forEach(l => { levelMap[l.name.toUpperCase()] = l.id; });

    const toUpsert = [];
    const unresolved = [];

    rows.forEach(row => {
      const levelId = levelMap[row.level];
      if (!levelId) {
        unresolved.push(`Level "${row.level}" không tìm thấy trong hệ thống (email: ${row.email})`);
        return;
      }
      toUpsert.push({ name: row.name, email: row.email, level_id: levelId, company: row.company, phone: row.phone, status: 'active' });
    });

    let inserted = [];
    if (toUpsert.length > 0) {
      inserted = await db.upsertContacts(toUpsert);
    }

    fs.unlinkSync(req.file.path);

    ok(res, {
      imported:   inserted.length,
      skipped:    unresolved.length,
      parseErrors: errors,
      levelErrors: unresolved,
    });
  } catch (e) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    err(res, e.message, 500);
  }
});

// ════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════

app.get('/api/templates', async (req, res) => {
  try { ok(res, await db.getTemplates()); }
  catch (e) { err(res, e.message, 500); }
});

app.post('/api/templates', async (req, res) => {
  try {
    const { name, icon, description, body, tags } = req.body;
    if (!name || !body) return err(res, 'name và body là bắt buộc');
    ok(res, await db.createTemplate({ name, icon, description, body, tags }));
  } catch (e) { err(res, e.message); }
});

app.put('/api/templates/:id', async (req, res) => {
  try {
    const { name, icon, description, body, tags } = req.body;
    ok(res, await db.updateTemplate(req.params.id, { name, icon, description, body, tags }));
  } catch (e) { err(res, e.message); }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    await db.deleteTemplate(req.params.id);
    ok(res, { deleted: true });
  } catch (e) { err(res, e.message); }
});

// ════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════

app.get('/api/campaigns', async (req, res) => {
  try { ok(res, await db.getCampaigns()); }
  catch (e) { err(res, e.message, 500); }
});

app.get('/api/campaigns/:id/logs', async (req, res) => {
  try { ok(res, await db.getCampaignLogs(req.params.id)); }
  catch (e) { err(res, e.message, 500); }
});

// Gửi test email
app.post('/api/campaigns/test-email', async (req, res) => {
  try {
    const { to, subject, body_text, from_name } = req.body;
    if (!to || !subject || !body_text) return err(res, 'Thiếu to, subject hoặc body_text');
    const result = await sendTestEmail({ to, subject, body_text, from_name });
    ok(res, result);
  } catch (e) { err(res, e.message); }
});

// Gửi campaign thật — dùng Server-Sent Events để stream tiến độ
app.post('/api/campaigns/send', async (req, res) => {
  const { name, from_name, from_email, subject, body_text, target_level_ids } = req.body;

  if (!name || !subject || !body_text || !target_level_ids?.length) {
    return err(res, 'Thiếu thông tin bắt buộc: name, subject, body_text, target_level_ids');
  }

  // Lấy contacts của các levels được chọn
  let contacts;
  try {
    contacts = await db.getContactsByLevelIds(target_level_ids);
  } catch (e) { return err(res, e.message, 500); }

  if (!contacts.length) return err(res, 'Không có contact nào trong các level đã chọn');

  // Tạo campaign record
  let campaign;
  try {
    campaign = await db.createCampaign({
      name, from_name, from_email: from_email || process.env.FROM_EMAIL,
      subject, body_text,
      target_levels: target_level_ids,
      status: 'sending',
    });
  } catch (e) { return err(res, e.message, 500); }

  // SSE headers để stream tiến độ về browser
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'start', total: contacts.length, campaignId: campaign.id });

  try {
    const { sent, failed, results } = await sendCampaign(
      { ...campaign },
      contacts,
      (progress) => send({ type: 'progress', ...progress }),
    );

    // Lưu tất cả send logs
    await Promise.all(results.map(r => db.logSend({
      campaign_id: campaign.id,
      contact_id:  r.contact_id,
      email:       r.email,
      level:       r.level,
      status:      r.status,
      resend_id:   r.resend_id,
      error_msg:   r.error_msg,
    })));

    // Cập nhật last_sent_at cho contacts gửi thành công
    const sentIds = results.filter(r => r.status === 'sent').map(r => r.contact_id).filter(Boolean);
    if (sentIds.length) await db.markLastSent(sentIds);

    // Cập nhật trạng thái campaign
    await db.updateCampaignStatus(campaign.id, {
      status: failed === contacts.length ? 'failed' : 'completed',
      sent_count: sent,
      failed_count: failed,
    });

    send({ type: 'done', sent, failed, total: contacts.length, campaignId: campaign.id });
  } catch (e) {
    await db.updateCampaignStatus(campaign.id, { status: 'failed', sent_count: 0, failed_count: contacts.length });
    send({ type: 'error', error: e.message });
  }

  res.end();
});

// ════════════════════════════════════════
// DASHBOARD STATS
// ════════════════════════════════════════

app.get('/api/stats', async (req, res) => {
  try { ok(res, await db.getDashStats()); }
  catch (e) { err(res, e.message, 500); }
});

// ─── Khởi động server ────────────────────────────────
// Tạo thư mục tmp nếu chưa có
if (!fs.existsSync(path.join(__dirname, 'tmp'))) {
  fs.mkdirSync(path.join(__dirname, 'tmp'));
}

app.listen(PORT, () => {
  console.log(`\n🚀 UCMAS MAIL server đang chạy: http://localhost:${PORT}`);
  console.log(`📬 Mở trình duyệt → http://localhost:${PORT}/ucmas-mail.html\n`);
});
