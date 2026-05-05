import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

const REQUIRED = ['name', 'email', 'level'];

/**
 * Parse từ Buffer (Vercel memory storage) hoặc file path (local server).
 */
export function parseContactBuffer(buffer, originalname) {
  const ext = originalname.split('.').pop().toLowerCase();
  let raw = [];

  if (ext === 'csv') {
    raw = parse(buffer.toString('utf-8'), {
      columns: true, skip_empty_lines: true, trim: true, bom: true,
    });
  } else if (['xlsx', 'xls'].includes(ext)) {
    const wb   = XLSX.read(buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } else {
    throw new Error('Chỉ hỗ trợ .csv, .xlsx, .xls');
  }

  return validateAndNormalize(raw);
}

function validateAndNormalize(raw) {
  if (!raw?.length) return { rows: [], errors: ['File trống'] };

  const normalized = raw.map(r => {
    const obj = {};
    for (const [k, v] of Object.entries(r)) obj[k.trim().toLowerCase()] = String(v || '').trim();
    return obj;
  });

  const headers = Object.keys(normalized[0] || {});
  const missing = REQUIRED.filter(c => !headers.includes(c));
  if (missing.length) {
    return { rows: [], errors: [`Thiếu cột: ${missing.join(', ')}. Cần có: name, email, level`] };
  }

  const rows = [], errors = [];
  normalized.forEach((row, i) => {
    const line = i + 2;
    if (!row.email?.includes('@')) { errors.push(`Dòng ${line}: email không hợp lệ`); return; }
    if (!row.name)  { errors.push(`Dòng ${line}: thiếu name`); return; }
    if (!row.level) { errors.push(`Dòng ${line}: thiếu level`); return; }
    rows.push({
      name: row.name, email: row.email.toLowerCase(),
      level: row.level.toUpperCase(), company: row.company || '', phone: row.phone || '',
    });
  });

  return { rows, errors };
}
