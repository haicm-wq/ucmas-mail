import { createClient } from '@supabase/supabase-js';

export function ok(res, data)  { res.status(200).json({ success: true, data }); }
export function err(res, msg, status = 400) {
  console.error('[API]', msg);
  res.status(status).json({ success: false, error: String(msg) });
}
export function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-sb-url,x-sb-key,x-resend-key,x-from-email');
}

// Tạo Supabase client từ env vars hoặc request headers (khi user dùng Settings trong app)
export function getDB(req) {
  const url = process.env.SUPABASE_URL     || req.headers['x-sb-url']  || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || req.headers['x-sb-key'] || '';
  if (!url || !key) throw new Error('Chưa cấu hình Supabase. Vào ⚙ Settings trong app để nhập URL và Key.');
  return createClient(url, key);
}

// Lấy Resend config từ env vars hoặc request headers
export function getEmailConfig(req) {
  return {
    resendKey: process.env.RESEND_API_KEY || req.headers['x-resend-key'] || '',
    fromEmail: process.env.FROM_EMAIL     || req.headers['x-from-email'] || '',
  };
}
