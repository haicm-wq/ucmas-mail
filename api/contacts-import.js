import multer from 'multer';
import { parseContactBuffer } from '../lib/csvParser.js';
import { importContacts } from '../lib/importHelper.js';
import { ok, err, allowCors, getDBFromReq } from './_utils.js';

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

    const db = getDBFromReq(req);
    const result = await importContacts(db, rows);
    ok(res, { ...result, parseErrors: errors });
  } catch (e) { err(res, e.message, 500); }
}
