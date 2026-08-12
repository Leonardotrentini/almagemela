/**
 * Webhook Hotmart → Meta Conversions API (Purchase real)
 * Configure na Hotmart: Ferramentas → Webhook → URL:
 * https://almagemela-steel.vercel.app/api/hotmart-webhook
 *
 * Env Vercel:
 * META_PIXEL_ID=38539014385698035
 * META_CAPI_TOKEN= (token do Events Manager)
 * HOTMART_HOTTOK= (opcional, validação)
 */

function getSupabaseConfig() {
  const supabaseUrl = (
    process.env.ALMAGEMELA_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim().replace(/\/$/, '');
  const supabaseKey = (process.env.ALMAGEMELA_SUPABASE_SECRET_KEY || '').trim();
  return { supabaseUrl, supabaseKey };
}

async function sendMetaPurchase({ email, value, currency, eventId, productName }) {
  const pixelId = (process.env.META_PIXEL_ID || '38539014385698035').trim();
  const token = (process.env.META_CAPI_TOKEN || process.env.META_ACCESS_TOKEN || '').trim();
  if (!token) {
    console.warn('META_CAPI_TOKEN não configurado — Purchase não enviado ao Meta');
    return { ok: false, reason: 'no_token' };
  }

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      user_data: email ? {
        em: [require('crypto').createHash('sha256').update(email.trim().toLowerCase()).digest('hex')],
      } : {},
      custom_data: {
        currency: currency || 'USD',
        value: value || 0,
        content_name: productName || 'Almagemela',
      },
    }],
  };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Meta CAPI error', json);
    return { ok: false, reason: 'meta_error', detail: json };
  }
  return { ok: true, meta: json };
}

async function markPurchased(email, value) {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey || !email) return;

  const safe = String(email).trim().toLowerCase();
  const progressEmail = safe.includes('@progress.almagemela.local')
    ? safe
    : null;

  // Atualiza lead por email real ou progress
  const filter = progressEmail
    ? `email=eq.${encodeURIComponent(progressEmail)}`
    : `email=eq.${encodeURIComponent(safe)}`;

  try {
    const getRes = await fetch(
      `${supabaseUrl}/rest/v1/leads?${filter}&select=*&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!getRes.ok) return;
    const rows = await getRes.json();
    const row = rows[0];
    if (!row) return;

    const answers = row.answers || {};
    answers._meta = {
      ...(answers._meta || {}),
      status: 'purchased',
      purchased_at: new Date().toISOString(),
      purchase_value: value,
    };

    await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ answers, source: 'almagemela_purchased' }),
    });
  } catch (e) {
    console.error('markPurchased', e);
  }
}

function parseHotmartBody(body) {
  if (!body || typeof body !== 'object') return null;

  // Hotmart v2 webhook format
  const event = body.event || body.status || '';
  const data = body.data || body;

  const approved = /APPROVED|COMPLETE|PURCHASE_COMPLETE|approved/i.test(String(event)) ||
    data.purchase?.status === 'APPROVED' ||
    body.status === 'approved';

  if (!approved && event && !/PURCHASE/i.test(String(event))) {
    return { skip: true, event };
  }

  const purchase = data.purchase || data;
  const buyer = data.buyer || purchase.buyer || {};
  const email = buyer.email || data.email || purchase.email || '';
  const price = purchase.price || purchase.full_price || data.price || {};
  const value = parseFloat(price.value || price || data.value || 0) || 0;
  const currency = (price.currency_code || price.currency || data.currency || 'USD').toUpperCase();
  const product = (data.product || purchase.product || {}).name || data.product_name || 'Almagemela';
  const transaction = purchase.transaction || purchase.order_date || data.transaction || Date.now();

  return {
    approved: approved || value > 0,
    email,
    value,
    currency,
    product,
    eventId: `hotmart_${transaction}_${email}`.slice(0, 64),
    rawEvent: event,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hotmart-Hottok');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // Hotmart sometimes validates with GET
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'hotmart-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const hottok = process.env.HOTMART_HOTTOK || '';
  if (hottok) {
    const given = req.headers['x-hotmart-hottok'] || req.query?.hottok || '';
    if (String(given) !== hottok) {
      return res.status(401).json({ error: 'Hottok inválido' });
    }
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }

  const parsed = parseHotmartBody(body);
  if (!parsed) {
    return res.status(400).json({ error: 'Payload inválido' });
  }
  if (parsed.skip) {
    return res.status(200).json({ ok: true, skipped: true, event: parsed.event });
  }
  if (!parsed.approved) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'not_approved' });
  }

  const meta = await sendMetaPurchase(parsed);
  if (parsed.email) await markPurchased(parsed.email, parsed.value);

  return res.status(200).json({
    ok: true,
    purchase: { value: parsed.value, currency: parsed.currency, email: parsed.email ? '***' : null },
    meta,
  });
};
