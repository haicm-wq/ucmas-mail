import { Resend } from 'resend';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function render(text, contact) {
  return text
    .replace(/\{\{name\}\}/g,    contact.name    || '')
    .replace(/\{\{email\}\}/g,   contact.email   || '')
    .replace(/\{\{level\}\}/g,   contact.level   || '')
    .replace(/\{\{company\}\}/g, contact.company || '')
    .replace(/\{\{date\}\}/g,    new Date().toLocaleDateString('vi-VN'));
}

function textToHtml(text) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:600px;margin:0 auto;padding:32px 20px;line-height:1.7}p{margin:0 0 12px}</style>
</head><body>
${text.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '<br>').join('\n')}
</body></html>`;
}

// resendKey và fromEmail nhận từ env vars hoặc app settings
export async function sendCampaign(campaign, contacts, onProgress, { resendKey, fromEmail } = {}) {
  const key  = resendKey  || process.env.RESEND_API_KEY || '';
  const from_addr = fromEmail || process.env.FROM_EMAIL  || 'noreply@example.com';

  if (!key) throw new Error('Chưa cấu hình Resend API Key. Vào ⚙ Settings để nhập.');

  const resend = new Resend(key);
  let sent = 0, failed = 0;
  const results = [];
  const from = `${campaign.from_name || 'UCMAS Vietnam'} <${from_addr}>`;

  for (const contact of contacts) {
    const level = contact.levels?.name || contact.level || '';
    const data  = { ...contact, level, company: contact.company || '' };
    const subject = render(campaign.subject, data);
    const text    = render(campaign.body_text, data);

    try {
      const { data: resp, error } = await resend.emails.send({
        from, to: [contact.email], subject, text, html: textToHtml(text),
      });
      if (error) throw new Error(error.message);
      sent++;
      const r = { contact_id: contact.id, email: contact.email, level, status: 'sent', resend_id: resp.id };
      results.push(r);
      if (onProgress) onProgress({ sent, failed, total: contacts.length, ...r });
    } catch (e) {
      failed++;
      const r = { contact_id: contact.id, email: contact.email, level, status: 'failed', error_msg: e.message };
      results.push(r);
      if (onProgress) onProgress({ sent, failed, total: contacts.length, ...r });
    }
    await sleep(200);
  }
  return { sent, failed, results };
}

export async function sendTestEmail({ to, subject, body_text, from_name }, { resendKey, fromEmail } = {}) {
  const key  = resendKey  || process.env.RESEND_API_KEY || '';
  const from_addr = fromEmail || process.env.FROM_EMAIL  || 'noreply@example.com';
  if (!key) throw new Error('Chưa cấu hình Resend API Key.');

  const resend = new Resend(key);
  const sample = { name: 'Nguyễn Văn A', email: to, level: 'L1', company: 'UCMAS' };
  const { data, error } = await resend.emails.send({
    from:    `${from_name || 'UCMAS Vietnam'} <${from_addr}>`,
    to:      [to],
    subject: render(subject, sample),
    text:    render(body_text, sample),
    html:    textToHtml(render(body_text, sample)),
  });
  if (error) throw new Error(error.message);
  return data;
}
