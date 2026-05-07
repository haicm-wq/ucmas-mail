import { ok, err, allowCors, getDBFromReq } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const db = getDBFromReq(req);

  try {
    // ══ TAGS TABLE CRUD ════════════════════════════════
    if (req.method === 'GET' && action === 'tags') {
      ok(res, await db.getTags());

    } else if (req.method === 'POST' && action === 'tags') {
      const { name, color, description } = req.body;
      if (!name?.trim()) return err(res, 'Tên tag không được rỗng');
      ok(res, await db.createTag({ name: name.trim(), color: color || '#a78bfa', description }));

    } else if (req.method === 'PATCH' && action === 'tags') {
      const { id, name, color, description } = req.body;
      if (!id) return err(res, 'Thiếu id');
      ok(res, await db.updateTag(id, { name, color, description }));

    } else if (req.method === 'DELETE' && action === 'tags') {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await db.deleteTag(id);
      ok(res, { deleted: true });

    // ══ SEGMENTS CRUD ══════════════════════════════════
    } else if (req.method === 'GET' && action === 'segments') {
      ok(res, await db.getSegments());

    } else if (req.method === 'POST' && action === 'segments') {
      const { name, color, description, rules, logic, tag_mode } = req.body;
      if (!name?.trim()) return err(res, 'Tên segment không được rỗng');
      ok(res, await db.createSegment({ name: name.trim(), color, description, rules: rules || [], logic: logic || 'and', tag_mode: tag_mode || 'or' }));

    } else if (req.method === 'PATCH' && action === 'segments') {
      const { id, ...data } = req.body;
      if (!id) return err(res, 'Thiếu id');
      ok(res, await db.updateSegment(id, data));

    } else if (req.method === 'DELETE' && action === 'segments') {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await db.deleteSegment(id);
      ok(res, { deleted: true });

    } else if (req.method === 'GET' && action === 'segment-count') {
      const { id } = req.query;
      if (!id) return err(res, 'Thiếu id');
      ok(res, { count: await db.countSegmentContacts(id) });

    // ══ CONTACTS CRUD ══════════════════════════════════
    } else if (req.method === 'POST' && action === 'bulk') {
      const { contacts } = req.body;
      if (!Array.isArray(contacts) || !contacts.length) return err(res, 'Danh sách contacts rỗng');
      const valid = contacts.filter(c => c.email?.includes('@') && c.level_id);
      if (!valid.length) return err(res, 'Không có contact hợp lệ (cần email và level_id)');
      ok(res, { imported: (await db.upsertContacts(valid)).length });

    } else if (req.method === 'PATCH' && action === 'level') {
      const { id, levelId } = req.body;
      if (!id || !levelId) return err(res, 'Thiếu id hoặc levelId');
      await db.updateContactLevel(id, levelId);
      ok(res, { updated: true });

    } else if (req.method === 'PATCH' && action === 'contact-tags') {
      const { id, tags: t } = req.body;
      if (!id) return err(res, 'Thiếu id');
      await db.updateContactTags(id, t || []);
      ok(res, { updated: true });

    } else if (req.method === 'PATCH' && action === 'bulk-tag') {
      const { ids, tag } = req.body;
      if (!ids?.length || !tag) return err(res, 'Thiếu ids hoặc tag');
      await db.bulkAddTag(ids, tag.trim());
      ok(res, { updated: ids.length });

    } else if (req.method === 'PATCH' && action === 'bulk-untag') {
      const { ids, tag } = req.body;
      if (!ids?.length || !tag) return err(res, 'Thiếu ids hoặc tag');
      await db.bulkRemoveTag(ids, tag.trim());
      ok(res, { updated: ids.length });

    } else if (req.method === 'GET') {
      const { levelId, search, status, page = 0, per_page = 200 } = req.query;
      const offset = parseInt(page) * parseInt(per_page);
      const tags = req.query.tags ? req.query.tags.split(',').filter(Boolean) : undefined;
      const tagMode = req.query.tagMode || 'and';
      ok(res, await db.getContactsPaged({ levelId, search, status, tags, tagMode, offset, limit: parseInt(per_page) }));

    } else if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await db.deleteContact(id);
      ok(res, { deleted: true });

    } else { res.status(405).json({ error: 'Method not allowed' }); }

  } catch (e) { err(res, e.message, 500); }
}
