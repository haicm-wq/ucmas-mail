import { allowCors, getDBFromReq } from './_utils.js';

/**
 * Resend Webhook Endpoint
 * Nhận events từ Resend: email.delivered, email.opened, email.clicked,
 * email.bounced, email.complained (spam), email.delivery_delayed
 *
 * Setup trong Resend Dashboard:
 *   Settings → Webhooks → Add Endpoint
 *   URL: https://your-domain/api/webhooks
 *   Events: email.delivered, email.opened, email.clicked, email.bounced, email.complained
 */
export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    if (!event || !event.type) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const db = getDBFromReq(req);
    const data = event.data || {};

    // Map Resend event types to our event names
    const eventMap = {
      'email.sent':             'sent',
      'email.delivered':        'delivered',
      'email.delivery_delayed': 'delayed',
      'email.opened':           'opened',
      'email.clicked':          'clicked',
      'email.bounced':          'bounced',
      'email.complained':       'complained', // spam
    };

    const eventType = eventMap[event.type];
    if (!eventType) {
      // Unknown event type — acknowledge but ignore
      return res.status(200).json({ received: true, ignored: true });
    }

    // Build event record
    const record = {
      resend_email_id: data.email_id || data.id || null,
      event_type: eventType,
      recipient_email: extractRecipient(data),
      metadata: {},
      created_at: data.created_at || new Date().toISOString(),
    };

    // Add specific metadata per event type
    if (eventType === 'clicked' && data.click) {
      record.metadata.url = data.click.link || data.click.url || '';
      record.metadata.user_agent = data.click.user_agent || '';
      record.metadata.ip_address = data.click.ip_address || '';
    }
    if (eventType === 'opened' && data.open) {
      record.metadata.user_agent = data.open.user_agent || '';
      record.metadata.ip_address = data.open.ip_address || '';
    }
    if (eventType === 'bounced' && data.bounce) {
      record.metadata.bounce_type = data.bounce.type || '';
      record.metadata.bounce_message = data.bounce.message || '';
    }
    if (eventType === 'complained') {
      record.metadata.complaint_type = 'spam';
    }

    // Save event to database
    await db.logEmailEvent(record);

    // Also update send_logs status for bounced/complained
    if ((eventType === 'bounced' || eventType === 'complained') && record.resend_email_id) {
      await db.updateSendLogByResendId(record.resend_email_id, eventType === 'bounced' ? 'bounced' : 'complained');
    }

    res.status(200).json({ received: true, event_type: eventType });
  } catch (e) {
    console.error('[Webhook Error]', e.message);
    // Always return 200 to Resend to prevent retries for processing errors
    res.status(200).json({ received: true, error: e.message });
  }
}

function extractRecipient(data) {
  if (data.to && Array.isArray(data.to)) return data.to[0];
  if (data.to && typeof data.to === 'string') return data.to;
  if (data.email) return data.email;
  return '';
}
