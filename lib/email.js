import { Resend } from 'resend';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Thay thế {{variables}} trong nội dung
function render(content, contact) {
  return content
    .replace(/\{\{name\}\}/g,    contact.name    || '')
    .replace(/\{\{email\}\}/g,   contact.email   || '')
    .replace(/\{\{level\}\}/g,   contact.level   || '')
    .replace(/\{\{company\}\}/g, contact.company || '')
    .replace(/\{\{date\}\}/g,    new Date().toLocaleDateString('vi-VN'));
}

// Detect nếu nội dung là HTML đầy đủ hay plain text
function isHtml(content) {
  const t = content.trimStart();
  return t.startsWith('<!DOCTYPE') || t.startsWith('<html') || t.startsWith('<HTML') || /<[a-z][\s\S]*>/i.test(t);
}

// Chuyển HTML → plain text đơn giản (dùng cho email client không hỗ trợ HTML)
function htmlToPlainText(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Wrap plain text thành HTML đơn giản
function plainTextToHtml(text) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:600px;margin:0 auto;padding:32px 20px;line-height:1.7}p{margin:0 0 12px}a{color:#4f6cff}</style>
</head><body>
${text.split('\n').map(l => l.trim() ? `<p>${l}</p>` : '').join('\n')}
</body></html>`;
}

// Chuẩn bị html + text cho Resend
function buildEmailPayload(bodyContent, contact) {
  const rendered = render(bodyContent, contact);

  if (isHtml(rendered)) {
    // Template HTML đầy đủ — gửi nguyên vẹn, tạo plain text từ HTML
    return { html: rendered, text: htmlToPlainText(rendered) };
  } else {
    // Plain text — tạo HTML wrapper đơn giản
    return { html: plainTextToHtml(rendered), text: rendered };
  }
}

export async function sendCampaign(campaign, contacts, onProgress, { resendKey, fromEmail } = {}) {
  const key      = resendKey  || process.env.RESEND_API_KEY || '';
  const from_addr = campaign.from_email || fromEmail || process.env.FROM_EMAIL || 'noreply@example.com';

  if (!key) throw new Error('Chưa cấu hình Resend API Key. Vào ⚙ Settings để nhập.');

  const resend = new Resend(key);
  let sent = 0, failed = 0;
  const results = [];
  const from = `${campaign.from_name || 'UCMAS Vietnam'} <${from_addr}>`;

  for (const contact of contacts) {
    const level   = contact.levels?.name || contact.level || '';
    const ctxData = { ...contact, level, company: contact.company || '' };
    const subject = render(campaign.subject, ctxData);
    const { html, text } = buildEmailPayload(campaign.body_text, ctxData);

    try {
      const { data: resp, error } = await resend.emails.send({
        from, to: [contact.email], subject, html, text,
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
  const key      = resendKey  || process.env.RESEND_API_KEY || '';
  const from_addr = fromEmail || process.env.FROM_EMAIL     || 'noreply@example.com';
  if (!key) throw new Error('Chưa cấu hình Resend API Key.');

  const resend  = new Resend(key);
  const sample  = { name: 'Nguyễn Văn A', email: to, level: 'L1', company: 'UCMAS Vietnam' };
  const subject_rendered = render(subject, sample);
  const { html, text } = buildEmailPayload(body_text, sample);

  const { data, error } = await resend.emails.send({
    from:    `${from_name || 'UCMAS Vietnam'} <${from_addr}>`,
    to:      [to],
    subject: subject_rendered,
    html,
    text,
  });
  if (error) throw new Error(error.message);
  return data;
}
