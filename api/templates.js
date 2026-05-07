import { ok, err, allowCors, getDBFromReq } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try { ok(res, await getDBFromReq(req).getTemplates()); }
    catch (e) { err(res, e.message, 500); }

  } else if (req.method === 'POST') {
    try {
      const { name, icon, description, body, tags } = req.body;
      if (!name || !body) return err(res, 'name và body là bắt buộc');
      ok(res, await getDBFromReq(req).createTemplate({ name, icon, description, body, tags }));
    } catch (e) { err(res, e.message); }

  } else if (req.method === 'PUT') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      ok(res, await getDBFromReq(req).updateTemplate(id, req.body));
    } catch (e) { err(res, e.message); }

  } else if (req.method === 'DELETE') {
    try {
      const id = req.query.id;
      if (!id) return err(res, 'Thiếu id');
      await getDBFromReq(req).deleteTemplate(id);
      ok(res, { deleted: true });
    } catch (e) { err(res, e.message); }

  } else { res.status(405).json({ error: 'Method not allowed' }); }
}
