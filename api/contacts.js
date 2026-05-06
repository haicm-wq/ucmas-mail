import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // --- BULK IMPORT (POST ?action=bulk) ---
  if (req.method === 'POST' && action === 'bulk') {
    try {
      const { contacts } = req.body;
      if (!Array.isArray(contacts) || !contacts.length) return err(res, 'Danh sách contacts rỗng');
      const valid = contacts.filter(c => c.email?.includes('@') && c.level_id);
      if (!valid.length) return err(res, 'Không có contact hợp lệ (cần email và level_id)');
      const db = makeDB(getDB(req));
      const inserted = await db.upsertContacts(valid);
      ok(res, { imported: inserted.length });
    } catch (e) { err(res, e.message, 500); }

  // --- UPDATE LEVEL (PATCH ?action=level) ---
  } else if (req.method === 'PATCH' && action === 'level') {
    try {
      const { id, levelId } = req.body;
      if (!id || !levelId) return err(res, 'Thiếu id hoặc levelId');
      await makeDB(getDB(req)).updateContactLevel(id, levelId);
      ok(res, { updated: true });
    } catch (e) { err(res, e.message); }

  // --- GET CONTACTS ---
  } else if (req.method === 'GET') {
    try {
      const { levelId, search, status, page = 0, per_page = 200 } = req.query;
      const db     = makeDB(getDB(req));
      const offset = parseInt(page) * parseInt(per_page);
      const result = await db.getContactsPaged({ levelId, search, status, offset, limit: parseInt(per_page) });
      ok(res, result);
    } catch (e) { err(res, e.message, 500); }

  // --- DELETE CONTACT ---
  } else if (req.method === 'DELETE') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await makeDB(getDB(req)).deleteContact(id);
      ok(res, { deleted: true });
    } catch (e) { err(res, e.message); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
