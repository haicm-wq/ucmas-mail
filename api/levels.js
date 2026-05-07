import { ok, err, allowCors, getDBFromReq } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const db = getDBFromReq(req);
      const [levels, countMap] = await Promise.all([
        db.getLevels(),
        db.getContactCountsPerLevel(),
      ]);
      ok(res, levels.map(l => ({ ...l, count: countMap[l.id] || 0 })));
    } catch (e) { err(res, e.message, 500); }

  } else if (req.method === 'POST') {
    try {
      const { name, color, parent_id, description, sort_order } = req.body;
      if (!name) return err(res, 'Tên level là bắt buộc');
      ok(res, await getDBFromReq(req).createLevel({ name, color: color || '#5ba8ff', parent_id, description, sort_order }));
    } catch (e) { err(res, e.message); }

  } else if (req.method === 'DELETE') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await getDBFromReq(req).deleteLevel(id);
      ok(res, { deleted: true });
    } catch (e) { err(res, e.message); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
