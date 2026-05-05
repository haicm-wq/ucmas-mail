import multer from 'multer';
import { makeDB } from '../lib/supabase.js';
import { parseContactBuffer } from '../lib/csvParser.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export const config = { api: { bodyParser: false } };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => fn(req, res, e => e ? reject(e) : resolve()));
}

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await runMiddleware(req, res, upload.single('file'));
    const file = req.file;
    if (!file) return err(res, 'Không có file được tải lên');

    const { rows, errors } = parseContactBuffer(file.buffer, file.originalname);
    if (rows.length === 0) return err(res, errors.join('; '));

    const db = makeDB(getDB(req));
    const levels = await db.getLevels();
    const levelMap = {};
    levels.forEach(l => { levelMap[l.name.toUpperCase()] = l.id; });

    const toUpsert = [], unresolved = [];
    rows.forEach(row => {
      const levelId = levelMap[row.level];
      if (!levelId) { unresolved.push(`Level "${row.level}" không tìm thấy (${row.email})`); return; }
      toUpsert.push({ name: row.name, email: row.email, level_id: levelId, company: row.company, phone: row.phone, status: 'active' });
    });

    const inserted = toUpsert.length > 0 ? await db.upsertContacts(toUpsert) : [];
    ok(res, { imported: inserted.length, skipped: unresolved.length, parseErrors: errors, levelErrors: unresolved });
  } catch (e) { err(res, e.message, 500); }
}
