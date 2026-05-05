import { Resend } from 'resend';

const resend    = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@yourdomain.com';

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

export async function sendCampaign(campaign, contacts, onProgress) {
  let sent = 0, failed = 0;
  const results = [];
  const from = `${campaign.from_name || 'UCMAS Vietnam'} <${FROM_EMAIL}>`;

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
    } catch (err) {
      failed++;
      const r = { contact_id: contact.id, email: contact.email, level, status: 'failed', error_msg: err.message };
      results.push(r);
      if (onProgress) onProgress({ sent, failed, total: contacts.length, ...r });
    }

    await sleep(200);
  }

  return { sent, failed, results };
}

export async function sendTestEmail({ to, subject, body_text, from_name }) {
  const sample = { name: 'Nguyễn Văn A', email: to, level: 'L1', company: 'UCMAS' };
  const { data, error } = await resend.emails.send({
    from:    `${from_name || 'UCMAS Vietnam'} <${FROM_EMAIL}>`,
    to:      [to],
    subject: render(subject, sample),
    text:    render(body_text, sample),
    html:    textToHtml(render(body_text, sample)),
  });
  if (error) throw new Error(error.message);
  return data;
}
