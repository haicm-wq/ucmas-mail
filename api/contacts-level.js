import { updateContactLevel } from '../lib/supabase.js';
import { ok, err, allowCors } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id, levelId } = req.body;
    if (!id || !levelId) return err(res, 'Thiếu id hoặc levelId');
    await updateContactLevel(id, levelId);
    ok(res, { updated: true });
  } catch (e) { err(res, e.message); }
}
