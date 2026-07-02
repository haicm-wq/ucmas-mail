import { ok, err, allowCors, getDB } from './_utils.js';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sb = getDB(req);
    const { base64, filename } = req.body;

    if (!base64) return err(res, 'Thiếu dữ liệu ảnh (base64)');

    // Parse base64 data URL → Buffer
    const matches = base64.match(/^data:(.+);base64,(.+)$/);
    if (!matches) return err(res, 'Định dạng ảnh không hợp lệ');

    const mimeType = matches[1]; // e.g. 'image/jpeg'
    const buffer = Buffer.from(matches[2], 'base64');
    
    // Tạo tên file unique
    const ext = mimeType.split('/')[1] || 'jpg';
    const name = filename || `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const path = `email-images/${name}`;

    // Upload lên Supabase Storage (bucket: 'email-assets')
    const { data, error: uploadErr } = await sb.storage
      .from('email-assets')
      .upload(path, buffer, {
        contentType: mimeType,
        cacheControl: '31536000', // Cache 1 năm
        upsert: true,
      });

    if (uploadErr) {
      // Nếu bucket chưa tồn tại, tự tạo
      if (uploadErr.message?.includes('not found') || uploadErr.statusCode === 404) {
        // Tạo bucket public
        const { error: createErr } = await sb.storage.createBucket('email-assets', {
          public: true,
          fileSizeLimit: 10485760, // 10MB
        });
        if (createErr && !createErr.message?.includes('already exists')) {
          return err(res, 'Không tạo được bucket: ' + createErr.message, 500);
        }
        // Retry upload
        const { error: retryErr } = await sb.storage
          .from('email-assets')
          .upload(path, buffer, { contentType: mimeType, cacheControl: '31536000', upsert: true });
        if (retryErr) return err(res, 'Upload thất bại: ' + retryErr.message, 500);
      } else {
        return err(res, 'Upload thất bại: ' + uploadErr.message, 500);
      }
    }

    // Lấy public URL
    const { data: urlData } = sb.storage.from('email-assets').getPublicUrl(path);
    
    return ok(res, { url: urlData.publicUrl, path });
  } catch (e) {
    return err(res, e.message, 500);
  }
}
