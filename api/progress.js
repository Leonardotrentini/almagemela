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

function sessionEmail(visitorId) {
  const safe = String(visitorId).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return `v_${safe}@progress.almagemela.local`;
}

async function sbFetch(supabaseUrl, supabaseKey, path, options = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
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
  const answersIn = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const statusIn = String(body.status || '').trim().toLowerCase();
  const allowed = new Set(['started', 'in_progress', 'reading', 'checkout', 'downsell', 'purchased']);
  const statusWanted = allowed.has(statusIn) ? statusIn : (currentStep > 0 ? 'in_progress' : 'started');
  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null;
  const email = sessionEmail(visitorId);

  const rank = { started: 1, in_progress: 2, reading: 3, checkout: 4, downsell: 4, purchased: 5 };

  try {
    // 1) tenta quiz_sessions (se a tabela existir)
    const qsPayload = {
      visitor_id: visitorId,
      ip,
      name,
      birth_date: birthDate,
      current_step: currentStep,
      max_step: currentStep,
      step_label: stepLabel,
      card,
      answers: answersIn,
      status: statusWanted,
      last_event: lastEvent,
      user_agent: userAgent,
      updated_at: new Date().toISOString(),
    };

    const qsRes = await sbFetch(
      supabaseUrl,
      supabaseKey,
      'quiz_sessions?on_conflict=visitor_id',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(qsPayload),
      }
    );

    if (qsRes.ok) {
      const rows = await qsRes.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      return res.status(200).json({
        ok: true,
        storage: 'quiz_sessions',
        id: row?.id,
        visitor_id: visitorId,
        current_step: currentStep,
        status: statusWanted,
      });
    }

    const qsErr = await qsRes.text();
    const missingTable = qsRes.status === 404 || /PGRST205|quiz_sessions/i.test(qsErr);
    if (!missingTable) {
      console.error('quiz_sessions error', qsRes.status, qsErr);
      // continua fallback leads
    }

    // 2) fallback: tabela leads (já existe)
    const getRes = await sbFetch(
      supabaseUrl,
      supabaseKey,
      `leads?email=eq.${encodeURIComponent(email)}&select=*&limit=1`
    );
    let existing = null;
    if (getRes.ok) {
      const rows = await getRes.json();
      existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    const prevMeta = (existing?.answers && existing.answers._meta) || {};
    const prevStatus = prevMeta.status || 'started';
    let nextStatus = statusWanted;
    if ((rank[nextStatus] || 0) < (rank[prevStatus] || 0) &&
        !(statusWanted === 'downsell' || statusWanted === 'checkout' || statusWanted === 'purchased')) {
      nextStatus = prevStatus;
    }
    if (prevStatus === 'purchased') nextStatus = 'purchased';

    const maxStep = Math.max(prevMeta.max_step || 0, currentStep, prevMeta.current_step || 0);
    const mergedAnswers = {
      ...(existing?.answers || {}),
      ...answersIn,
      _meta: {
        visitor_id: visitorId,
        ip: ip || prevMeta.ip || null,
        birth_date: birthDate || prevMeta.birth_date || null,
        current_step: currentStep || prevMeta.current_step || 0,
        max_step: maxStep,
        step_label: stepLabel || prevMeta.step_label || null,
        status: nextStatus,
        last_event: lastEvent || prevMeta.last_event || null,
        user_agent: userAgent || prevMeta.user_agent || null,
        updated_at: new Date().toISOString(),
      },
    };
    // não vazar meta antiga sobrescrita
    delete mergedAnswers.name;
    delete mergedAnswers.email;
    delete mergedAnswers.phone;

    const leadPayload = {
      name: name || existing?.name || 'Anónimo',
      email,
      phone: ip || existing?.phone || null,
      optin: false,
      card: card || existing?.card || null,
      answers: mergedAnswers,
      source: 'almagemela_progress',
      user_agent: userAgent || existing?.user_agent || null,
    };

    let saveRes;
    if (existing?.id) {
      saveRes = await sbFetch(
        supabaseUrl,
        supabaseKey,
        `leads?id=eq.${encodeURIComponent(existing.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(leadPayload),
        }
      );
    } else {
      saveRes = await sbFetch(supabaseUrl, supabaseKey, 'leads', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(leadPayload),
      });
    }

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error('leads progress error', saveRes.status, errText);
      return res.status(502).json({ error: 'Falha ao salvar progresso', detail: errText.slice(0, 240) });
    }

    const saved = await saveRes.json();
    const row = Array.isArray(saved) ? saved[0] : saved;
    return res.status(200).json({
      ok: true,
      storage: 'leads',
      id: row?.id,
      visitor_id: visitorId,
      current_step: maxStep,
      status: nextStatus,
    });
  } catch (err) {
    console.error('Progress API error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
