import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const db = makeDB(getDB(req));
      const [levels, countMap] = await Promise.all([
        db.getLevels(),
        db.getContactCountsPerLevel(), // đếm chính xác toàn bộ contacts
      ]);
      ok(res, levels.map(l => ({ ...l, count: countMap[l.id] || 0 })));
    } catch (e) { err(res, e.message, 500); }

  } else if (req.method === 'POST') {
    try {
      const { name, color, parent_id, description, sort_order } = req.body;
      if (!name) return err(res, 'Tên level là bắt buộc');
      ok(res, await makeDB(getDB(req)).createLevel({ name, color: color || '#5ba8ff', parent_id, description, sort_order }));
    } catch (e) { err(res, e.message); }

  } else if (req.method === 'DELETE') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await makeDB(getDB(req)).deleteLevel(id);
      ok(res, { deleted: true });
    } catch (e) { err(res, e.message); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
