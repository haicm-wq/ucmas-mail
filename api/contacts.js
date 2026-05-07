import { ok, err, allowCors, getDBFromReq } from './_utils.js';

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
      const db = getDBFromReq(req);
      const inserted = await db.upsertContacts(valid);
      ok(res, { imported: inserted.length });
    } catch (e) { err(res, e.message, 500); }

  // --- UPDATE LEVEL (PATCH ?action=level) ---
  } else if (req.method === 'PATCH' && action === 'level') {
    try {
      const { id, levelId } = req.body;
      if (!id || !levelId) return err(res, 'Thiếu id hoặc levelId');
      await getDBFromReq(req).updateContactLevel(id, levelId);
      ok(res, { updated: true });
    } catch (e) { err(res, e.message); }

  // --- UPDATE TAGS (PATCH ?action=tags) ---
  } else if (req.method === 'PATCH' && action === 'tags') {
    try {
      const { id, tags } = req.body;
      if (!id) return err(res, 'Thiếu id');
      await getDBFromReq(req).updateContactTags(id, tags || []);
      ok(res, { updated: true });
    } catch (e) { err(res, e.message); }

  // --- BULK ADD TAG (PATCH ?action=bulk-tag) ---
  } else if (req.method === 'PATCH' && action === 'bulk-tag') {
    try {
      const { ids, tag } = req.body;
      if (!ids?.length || !tag) return err(res, 'Thiếu ids hoặc tag');
      await getDBFromReq(req).bulkAddTag(ids, tag.trim());
      ok(res, { updated: ids.length });
    } catch (e) { err(res, e.message, 500); }

  // --- BULK REMOVE TAG (PATCH ?action=bulk-untag) ---
  } else if (req.method === 'PATCH' && action === 'bulk-untag') {
    try {
      const { ids, tag } = req.body;
      if (!ids?.length || !tag) return err(res, 'Thiếu ids hoặc tag');
      await getDBFromReq(req).bulkRemoveTag(ids, tag.trim());
      ok(res, { updated: ids.length });
    } catch (e) { err(res, e.message, 500); }

  // --- GET ALL TAGS (GET ?action=tags) ---
  } else if (req.method === 'GET' && action === 'tags') {
    try {
      ok(res, await getDBFromReq(req).getAllTags());
    } catch (e) { err(res, e.message, 500); }

  // --- GET CONTACTS (with optional tag filter) ---
  } else if (req.method === 'GET') {
    try {
      const { levelId, search, status, page = 0, per_page = 200 } = req.query;
      const db = getDBFromReq(req);
      const offset = parseInt(page) * parseInt(per_page);
      // Parse tags from query: ?tags=vip,new&tagMode=or
      const tags = req.query.tags ? req.query.tags.split(',').filter(Boolean) : undefined;
      const tagMode = req.query.tagMode || 'and';
      const result = await db.getContactsPaged({ levelId, search, status, tags, tagMode, offset, limit: parseInt(per_page) });
      ok(res, result);
    } catch (e) { err(res, e.message, 500); }

  // --- DELETE CONTACT ---
  } else if (req.method === 'DELETE') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await getDBFromReq(req).deleteContact(id);
      ok(res, { deleted: true });
    } catch (e) { err(res, e.message); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
