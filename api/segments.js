import { ok, err, allowCors, getDBFromReq } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const db = getDBFromReq(req);

  try {
    // ── TAGS CRUD ──────────────────────────────────
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
      const { id } = req.query;
      if (!id) return err(res, 'Thiếu id');
      ok(res, await db.deleteTag(id));

    // ── SEGMENTS CRUD ──────────────────────────────
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
      const { id } = req.query;
      if (!id) return err(res, 'Thiếu id');
      ok(res, await db.deleteSegment(id));

    // ── COUNT SEGMENT CONTACTS ─────────────────────
    } else if (req.method === 'GET' && action === 'segment-count') {
      const { id } = req.query;
      if (!id) return err(res, 'Thiếu id');
      const count = await db.countSegmentContacts(id);
      ok(res, { count });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (e) { err(res, e.message, 500); }
}
