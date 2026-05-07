import { ok, err, allowCors, getDBFromReq } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = getDBFromReq(req);

    if (req.method === 'GET') {
      ok(res, await db.getWorkflows());

    } else if (req.method === 'POST') {
      const { name, status, nodes } = req.body;
      if (!name) return err(res, 'name là bắt buộc');
      ok(res, await db.createWorkflow({ name, status: status || 'draft', nodes: nodes || [] }));

    } else if (req.method === 'PUT') {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      ok(res, await db.updateWorkflow(id, req.body));

    } else if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await db.deleteWorkflow(id);
      ok(res, { deleted: true });

    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (e) { err(res, e.message, 500); }
}
