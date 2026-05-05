export function ok(res, data)  { res.status(200).json({ success: true, data }); }
export function err(res, msg, status = 400) {
  console.error('[API]', msg);
  res.status(status).json({ success: false, error: String(msg) });
}

export function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
