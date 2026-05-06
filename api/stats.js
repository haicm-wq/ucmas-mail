import { makeDB } from '../lib/supabase.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    ok(res, await makeDB(getDB(req)).getDashStats());
  } catch (e) { err(res, e.message, 500); }
}
