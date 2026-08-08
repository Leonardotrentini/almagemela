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

  // Nomes próprios: a integração Vercel↔Supabase sobrescreve SUPABASE_URL/SECRET
  const supabaseUrl = (
    process.env.ALMAGEMELA_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim().replace(/\/$/, '');

  const supabaseKey = (
    process.env.ALMAGEMELA_SUPABASE_SECRET_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }
  body = body || {};

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const optin = Boolean(body.optin);
  const card = body.card ? String(body.card).slice(0, 64) : null;
  const rawAnswers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const answers = { ...rawAnswers };
  delete answers.name;
  delete answers.email;
  delete answers.phone;

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
