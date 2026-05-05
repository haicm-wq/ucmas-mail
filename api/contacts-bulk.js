import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || !contacts.length) return err(res, 'Danh sách contacts rỗng');

    // Validate
    const valid = contacts.filter(c => c.email?.includes('@') && c.level_id);
    if (!valid.length) return err(res, 'Không có contact hợp lệ (cần email và level_id)');

    const db = makeDB(getDB(req));
    const inserted = await db.upsertContacts(valid);

    ok(res, { imported: inserted.length });
  } catch (e) { err(res, e.message, 500); }
}
