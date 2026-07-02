import { sendTestEmail } from '../lib/email.js';
import { ok, err, allowCors, getDB, getDBFromReq, getEmailConfig } from './_utils.js';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // --- UPLOAD IMAGE (POST ?action=upload-image) ---
  if (req.method === 'POST' && action === 'upload-image') {
    try {
      const sb = getDB(req);
      const { base64 } = req.body;
      if (!base64) return err(res, 'Thiếu dữ liệu ảnh (base64)');

      const matches = base64.match(/^data:(.+);base64,(.+)$/);
      if (!matches) return err(res, 'Định dạng ảnh không hợp lệ');

      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      const ext = mimeType.split('/')[1] || 'jpg';
      const name = `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
      const path = `email-images/${name}`;

      let uploadResult = await sb.storage.from('email-assets')
        .upload(path, buffer, { contentType: mimeType, cacheControl: '31536000', upsert: true });

      if (uploadResult.error) {
        if (uploadResult.error.message?.includes('not found') || uploadResult.error.statusCode === 404) {
          await sb.storage.createBucket('email-assets', { public: true, fileSizeLimit: 10485760 });
          uploadResult = await sb.storage.from('email-assets')
            .upload(path, buffer, { contentType: mimeType, cacheControl: '31536000', upsert: true });
        }
        if (uploadResult.error) return err(res, 'Upload thất bại: ' + uploadResult.error.message, 500);
      }

      const { data: urlData } = sb.storage.from('email-assets').getPublicUrl(path);
      return ok(res, { url: urlData.publicUrl, path });
    } catch (e) { return err(res, e.message, 500); }

  // --- TEST EMAIL (POST ?action=test) ---
  } else if (req.method === 'POST' && action === 'test') {
    try {
      const { to, subject, body_text, from_name } = req.body;
      if (!to || !subject || !body_text) return err(res, 'Thiếu to, subject hoặc body_text');
      ok(res, await sendTestEmail({ to, subject, body_text, from_name }, getEmailConfig(req)));
    } catch (e) { err(res, e.message); }

  // --- GET CAMPAIGNS / HISTORY ---
  } else if (req.method === 'GET') {
    try {
      const db = getDBFromReq(req);
      if (req.query.contact_email) {
        ok(res, await db.getContactEmailHistory(req.query.contact_email));
      } else if (req.query.logs) {
        ok(res, await db.getCampaignLogs(req.query.logs));
      } else {
        ok(res, await db.getCampaigns());
      }
    } catch (e) { err(res, e.message, 500); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
