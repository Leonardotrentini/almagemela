module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const optin = Boolean(body.optin);
  const card = body.card ? String(body.card).slice(0, 64) : null;
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'Nome inválido' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }

  const payload = {
    name: name.slice(0, 120),
    email: email.slice(0, 190),
    phone: phone ? phone.slice(0, 40) : null,
    optin,
    card,
    answers,
    source: 'almagemela',
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
  };

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase error:', response.status, errText);
      return res.status(502).json({ error: 'Falha ao salvar lead' });
    }

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Lead API error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
