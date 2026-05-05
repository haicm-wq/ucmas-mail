import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { levelId, search, status, page = 0, per_page = 200 } = req.query;
      const db     = makeDB(getDB(req));
      const offset = parseInt(page) * parseInt(per_page);
      const result = await db.getContactsPaged({ levelId, search, status, offset, limit: parseInt(per_page) });
      ok(res, result); // { data, total }
    } catch (e) { err(res, e.message, 500); }

  } else if (req.method === 'DELETE') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await makeDB(getDB(req)).deleteContact(id);
      ok(res, { deleted: true });
    } catch (e) { err(res, e.message); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
