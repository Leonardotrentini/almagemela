function getSupabaseConfig() {
  const supabaseUrl = (
    process.env.ALMAGEMELA_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim().replace(/\/$/, '');
  const supabaseKey = (process.env.ALMAGEMELA_SUPABASE_SECRET_KEY || '').trim();
  return { supabaseUrl, supabaseKey };
}

function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || process.env.ALMAGEMELA_ADMIN_PASSWORD || '').trim();
}

function checkAuth(req) {
  const expected = adminPassword();
  if (!expected) return { ok: false, reason: 'ADMIN_PASSWORD não configurada na Vercel' };
  const header = String(req.headers['x-admin-key'] || '').trim();
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const q = req.query && req.query.key ? String(req.query.key).trim() : '';
  const given = header || auth || q;
  return { ok: given && given === expected, reason: 'Senha inválida' };
}

function normalizeFromLead(row) {
  const meta = (row.answers && row.answers._meta) || {};
  const isProgress = row.source === 'almagemela_progress' ||
    String(row.email || '').endsWith('@progress.almagemela.local');
  return {
    id: row.id,
    visitor_id: meta.visitor_id || (isProgress ? String(row.email || '').split('@')[0].replace(/^v_/, '') : row.id),
    ip: meta.ip || row.phone || null,
    name: row.name && row.name !== 'Anónimo' ? row.name : (meta.name || null),
    birth_date: meta.birth_date || null,
    current_step: meta.current_step || 0,
    max_step: meta.max_step || meta.current_step || 0,
    step_label: meta.step_label || null,
    card: row.card || null,
    answers: row.answers || {},
    status: meta.status || (isProgress ? 'started' : 'checkout'),
    last_event: meta.last_event || null,
    user_agent: row.user_agent || meta.user_agent || null,
    created_at: row.created_at,
    updated_at: meta.updated_at || row.created_at,
    storage: 'leads',
  };
}

function normalizeFromSession(row) {
  return { ...row, storage: 'quiz_sessions' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.reason });

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase não configurado' });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const statusFilter = req.query.status ? String(req.query.status).trim() : '';
  const q = req.query.q ? String(req.query.q).trim() : '';

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  let sessions = [];

  // Prefer quiz_sessions
  try {
    let url = `${supabaseUrl}/rest/v1/quiz_sessions?select=*&order=updated_at.desc&limit=${limit}`;
    if (statusFilter) url += `&status=eq.${encodeURIComponent(statusFilter)}`;
    if (q) url += `&name=ilike.*${encodeURIComponent(q)}*`;
    const response = await fetch(url, { headers });
    if (response.ok) {
      const rows = await response.json();
      sessions = (rows || []).map(normalizeFromSession);
    }
  } catch (e) {
    console.error('quiz_sessions list', e);
  }

  // Sempre também puxa progresso em leads (fallback / histórico)
  try {
    let url = `${supabaseUrl}/rest/v1/leads?select=*&order=created_at.desc&limit=${limit}`;
    if (q) url += `&name=ilike.*${encodeURIComponent(q)}*`;
    const response = await fetch(url, { headers });
    if (response.ok) {
      const rows = await response.json();
      const fromLeads = (rows || [])
        .filter((r) =>
          r.source === 'almagemela_progress' ||
          String(r.email || '').endsWith('@progress.almagemela.local') ||
          (r.answers && r.answers._meta && r.answers._meta.visitor_id)
        )
        .map(normalizeFromLead);

      // merge por visitor_id (quiz_sessions ganha se existir)
      const byVid = new Map();
      for (const s of fromLeads) byVid.set(s.visitor_id, s);
      for (const s of sessions) byVid.set(s.visitor_id, s);
      sessions = Array.from(byVid.values());
    } else {
      const errText = await response.text();
      if (!sessions.length) {
        return res.status(502).json({ error: 'Falha ao listar leads', detail: errText.slice(0, 300) });
      }
    }
  } catch (err) {
    console.error('Admin API error:', err);
    if (!sessions.length) return res.status(500).json({ error: 'Erro interno' });
  }

  if (statusFilter) {
    sessions = sessions.filter((s) => s.status === statusFilter);
  }

  sessions.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  sessions = sessions.slice(0, limit);

  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total: sessions.length,
    today: sessions.filter((r) => String(r.created_at || r.updated_at || '').startsWith(today)).length,
    reading: sessions.filter((r) => r.status === 'reading' || (r.max_step || 0) >= 19).length,
    checkout: sessions.filter((r) => r.status === 'checkout' || r.status === 'purchased').length,
    downsell: sessions.filter((r) => r.status === 'downsell').length,
    in_progress: sessions.filter((r) => r.status === 'in_progress' || r.status === 'started').length,
  };

  return res.status(200).json({ ok: true, stats, sessions });
};
