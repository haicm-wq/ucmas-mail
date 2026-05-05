import { allowCors } from './_utils.js';

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Trả về trạng thái config — KHÔNG trả về key thật
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasResend   = !!(process.env.RESEND_API_KEY && process.env.FROM_EMAIL);

  res.status(200).json({
    configured: hasSupabase,
    hasSupabase,
    hasResend,
    fromEmail: hasResend ? process.env.FROM_EMAIL : null,
  });
}
