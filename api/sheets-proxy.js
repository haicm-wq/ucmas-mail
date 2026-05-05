import { makeDB } from '../lib/supabase.js';
import { parseContactBuffer } from '../lib/csvParser.js';
import { ok, err, allowCors, getDB } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url) return err(res, 'Thiếu url parameter');

  // Chỉ cho phép Google Sheets URLs
  if (!url.includes('docs.google.com/spreadsheets')) {
    return err(res, 'Chỉ hỗ trợ Google Sheets URL');
  }

  try {
    const csvRes = await fetch(url, {
      headers: { 'User-Agent': 'UCMAS-Mail/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!csvRes.ok) throw new Error(`Google Sheets trả về HTTP ${csvRes.status}`);

    const csvText = await csvRes.text();
    const buffer = Buffer.from(csvText, 'utf-8');

    const { rows, errors } = parseContactBuffer(buffer, 'sheet.csv');
    if (rows.length === 0) return err(res, errors.join('; '));

    const db = makeDB(getDB(req));
    const levels = await db.getLevels();
    const levelMap = {};
    levels.forEach(l => { levelMap[l.name.toUpperCase()] = l.id; });

    const toUpsert = [], unresolved = [];
    rows.forEach(row => {
      const levelId = levelMap[row.level];
      if (!levelId) { unresolved.push(`Level "${row.level}" không tìm thấy (${row.email})`); return; }
      toUpsert.push({
        name: row.name, email: row.email,
        level_id: levelId, company: row.company,
        phone: row.phone, status: 'active',
      });
    });

    const inserted = toUpsert.length > 0 ? await db.upsertContacts(toUpsert) : [];

    ok(res, {
      imported:    inserted.length,
      skipped:     unresolved.length,
      parseErrors: errors,
      levelErrors: unresolved,
    });
  } catch (e) { err(res, e.message, 500); }
}
