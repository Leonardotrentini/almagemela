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

function mergeVsl(prev, next) {
  prev = prev && typeof prev === 'object' ? prev : {};
  next = next && typeof next === 'object' ? next : {};
  return {
    page: !!(prev.page || next.page),
    started: !!(prev.started || next.started),
    offer_shown: !!(prev.offer_shown || next.offer_shown),
    seconds: Math.max(parseInt(prev.seconds, 10) || 0, parseInt(next.seconds, 10) || 0),
  };
}

function pickStatus(wanted, prev, rank) {
  if (prev === 'purchased') return 'purchased';
  if ((rank[wanted] || 0) < (rank[prev] || 0) &&
      wanted !== 'downsell' && wanted !== 'checkout' && wanted !== 'purchased') {
    return prev;
  }
  return wanted;
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
    let existingQs = null;
    const existingRes = await sbFetch(
      supabaseUrl,
      supabaseKey,
      `quiz_sessions?visitor_id=eq.${encodeURIComponent(visitorId)}&select=*&limit=1`
    );
    if (existingRes.ok) {
      const rows = await existingRes.json();
      existingQs = Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    const prevAnswers = (existingQs && existingQs.answers && typeof existingQs.answers === 'object')
      ? existingQs.answers : {};
    const mergedAnswers = {
      ...prevAnswers,
      ...answersIn,
      vsl: mergeVsl(prevAnswers.vsl, answersIn.vsl),
    };
    const prevStep = parseInt(existingQs && existingQs.current_step, 10) || 0;
    const storedStep = currentStep >= prevStep ? currentStep : prevStep;
    const maxStep = Math.max(
      parseInt(existingQs && existingQs.max_step, 10) || 0,
      prevStep,
      currentStep
    );
    const nextStatus = pickStatus(statusWanted, existingQs && existingQs.status, rank);
    const nextLabel = (currentStep >= prevStep)
      ? (stepLabel || (existingQs && existingQs.step_label) || null)
      : ((existingQs && existingQs.step_label) || stepLabel);

    const qsPayload = {
      visitor_id: visitorId,
      ip: ip || (existingQs && existingQs.ip) || null,
      name: name || (existingQs && existingQs.name) || null,
      birth_date: birthDate || (existingQs && existingQs.birth_date) || null,
      current_step: storedStep,
      max_step: maxStep,
      step_label: nextLabel,
      card: card || (existingQs && existingQs.card) || null,
      answers: mergedAnswers,
      status: nextStatus,
      last_event: lastEvent || (existingQs && existingQs.last_event) || null,
      user_agent: userAgent || (existingQs && existingQs.user_agent) || null,
      updated_at: new Date().toISOString(),
    };

    const qsRes = await sbFetch(
      supabaseUrl,
      supabaseKey,
      existingQs
        ? `quiz_sessions?visitor_id=eq.${encodeURIComponent(visitorId)}`
        : 'quiz_sessions?on_conflict=visitor_id',
      {
        method: existingQs ? 'PATCH' : 'POST',
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
        current_step: storedStep,
        max_step: maxStep,
        status: nextStatus,
        vsl: mergedAnswers.vsl,
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
    const leadStatus = pickStatus(statusWanted, prevStatus, rank);
    const leadPrevStep = parseInt(prevMeta.current_step, 10) || 0;
    const leadStoredStep = currentStep >= leadPrevStep ? currentStep : leadPrevStep;
    const leadMaxStep = Math.max(prevMeta.max_step || 0, currentStep, leadPrevStep);
    const prevVsl = (existing?.answers && existing.answers.vsl) || prevMeta.vsl || {};
    const leadAnswers = {
      ...(existing?.answers || {}),
      ...answersIn,
      vsl: mergeVsl(prevVsl, answersIn.vsl),
      _meta: {
        visitor_id: visitorId,
        ip: ip || prevMeta.ip || null,
        birth_date: birthDate || prevMeta.birth_date || null,
        current_step: leadStoredStep,
        max_step: leadMaxStep,
        step_label: currentStep >= leadPrevStep
          ? (stepLabel || prevMeta.step_label || null)
          : (prevMeta.step_label || stepLabel),
        status: leadStatus,
        last_event: lastEvent || prevMeta.last_event || null,
        user_agent: userAgent || prevMeta.user_agent || null,
        vsl: mergeVsl(prevVsl, answersIn.vsl),
        updated_at: new Date().toISOString(),
      },
    };
    delete leadAnswers.name;
    delete leadAnswers.email;
    delete leadAnswers.phone;

    const leadPayload = {
      name: name || existing?.name || 'Anónimo',
      email,
      phone: ip || existing?.phone || null,
      optin: false,
      card: card || existing?.card || null,
      answers: leadAnswers,
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
      current_step: leadStoredStep,
      max_step: leadMaxStep,
      status: leadStatus,
    });
  } catch (err) {
    console.error('Progress API error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
