import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { levelId, search, status } = req.query;
      ok(res, await makeDB(getDB(req)).getContacts({ levelId, search, status }));
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
