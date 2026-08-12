function getSupabaseConfig() {
  const supabaseUrl = (
    process.env.ALMAGEMELA_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim().replace(/\/$/, '');
  const supabaseKey = (process.env.ALMAGEMELA_SUPABASE_SECRET_KEY || '').trim();
  return { supabaseUrl, supabaseKey };
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  return (xf || real || '').slice(0, 64) || null;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }
  body = body || {};

  const visitorId = String(body.visitor_id || '').trim().slice(0, 80);
  if (!visitorId || visitorId.length < 8) {
    return res.status(400).json({ error: 'visitor_id inválido' });
  }

  const name = body.name ? String(body.name).trim().slice(0, 120) : null;
  const birthDate = body.birth_date ? String(body.birth_date).trim().slice(0, 32) : null;
  const currentStep = Math.max(0, Math.min(19, parseInt(body.current_step, 10) || 0));
  const stepLabel = body.step_label ? String(body.step_label).trim().slice(0, 80) : null;
  const card = body.card ? String(body.card).trim().slice(0, 64) : null;
  const lastEvent = body.event ? String(body.event).trim().slice(0, 64) : null;
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const statusIn = String(body.status || '').trim().toLowerCase();
  const allowed = new Set(['started', 'in_progress', 'reading', 'checkout', 'downsell', 'purchased']);
  const status = allowed.has(statusIn) ? statusIn : null;
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const now = new Date().toISOString();

  // Busca sessão existente para preservar max_step / status “maior”
  let existing = null;
  try {
    const getRes = await fetch(
      `${supabaseUrl}/rest/v1/quiz_sessions?visitor_id=eq.${encodeURIComponent(visitorId)}&select=*&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    if (getRes.ok) {
      const rows = await getRes.json();
      existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    }
  } catch (e) {
    console.error('progress get error', e);
  }

  const rank = { started: 1, in_progress: 2, reading: 3, checkout: 4, downsell: 4, purchased: 5 };
  let nextStatus = status || (existing && existing.status) || (currentStep > 0 ? 'in_progress' : 'started');
  if (existing && existing.status) {
    const curR = rank[existing.status] || 0;
    const newR = rank[nextStatus] || 0;
    // Não rebaixar checkout/purchased para in_progress
    if (newR < curR && !(status === 'downsell' || status === 'checkout' || status === 'purchased')) {
      nextStatus = existing.status;
    }
    // downsell e checkout são ambos “funil final”; se já purchased, mantém
    if (existing.status === 'purchased') nextStatus = 'purchased';
  }

  const maxStep = Math.max(
    existing?.max_step || 0,
    currentStep,
    existing?.current_step || 0
  );

  const payload = {
    visitor_id: visitorId,
    ip: ip || existing?.ip || null,
    name: name || existing?.name || null,
    birth_date: birthDate || existing?.birth_date || null,
    current_step: currentStep || existing?.current_step || 0,
    max_step: maxStep,
    step_label: stepLabel || existing?.step_label || null,
    card: card || existing?.card || null,
    answers: Object.keys(answers).length ? answers : (existing?.answers || {}),
    status: nextStatus,
    last_event: lastEvent || existing?.last_event || null,
    user_agent: userAgent || existing?.user_agent || null,
    updated_at: now,
  };

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/quiz_sessions?on_conflict=visitor_id`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Supabase progress error:', response.status, errText);
      return res.status(502).json({ error: 'Falha ao salvar progresso', detail: errText.slice(0, 200) });
    }

    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return res.status(200).json({
      ok: true,
      id: row?.id,
      visitor_id: visitorId,
      current_step: payload.current_step,
      status: payload.status,
    });
  } catch (err) {
    console.error('Progress API error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
