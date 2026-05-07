import { parseContactBuffer } from '../lib/csvParser.js';
import { importContacts } from '../lib/importHelper.js';
import { ok, err, allowCors, getDBFromReq } from './_utils.js';

// Chuyển bất kỳ dạng Google Sheets URL → URL export CSV
function toCSVExportUrl(input) {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return null;
    const sheetId = match[1];
    const gid = url.searchParams.get('gid') || url.hash.match(/gid=(\d+)/)?.[1] || '0';
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url: rawUrl } = req.query;
  if (!rawUrl) return err(res, 'Thiếu url parameter');

  if (!rawUrl.includes('docs.google.com/spreadsheets')) {
    return err(res, 'Chỉ hỗ trợ Google Sheets URL (docs.google.com/spreadsheets/...)');
  }

  const csvUrl = toCSVExportUrl(rawUrl) || rawUrl;

  try {
    const csvRes = await fetch(csvUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (!csvRes.ok) {
      return err(res, `Google Sheets trả về lỗi HTTP ${csvRes.status}. Kiểm tra Sheet có public không.`);
    }

    const csvText = await csvRes.text();

    // Kiểm tra có phải HTML không (redirect login / lỗi)
    if (csvText.trimStart().startsWith('<')) {
      return err(res, 'Google Sheets yêu cầu đăng nhập. Hãy đặt Sheet ở chế độ "Anyone with the link can view".');
    }
    if (!csvText.trim()) {
      return err(res, 'Sheet trống hoặc không có dữ liệu.');
    }

    const buffer = Buffer.from(csvText, 'utf-8');
    const { rows, errors } = parseContactBuffer(buffer, 'sheet.csv');
    if (rows.length === 0) return err(res, errors.join('; '));

    const db = getDBFromReq(req);
    const result = await importContacts(db, rows);
    ok(res, { ...result, parseErrors: errors });
  } catch (e) {
    err(res, 'Không thể đọc Sheet: ' + e.message, 500);
  }
}
