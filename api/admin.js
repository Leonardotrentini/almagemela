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

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

function sessionEmail(visitorId) {
  const safe = String(visitorId).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return `v_${safe}@progress.almagemela.local`;
}

function isMissingQuizSessions(status, text) {
  return status === 404 || /PGRST205|quiz_sessions/i.test(String(text || ''));
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

const ADMIN_TZ = 'America/Sao_Paulo';

function dateInTz(iso, tz) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch (e) {
    return '';
  }
}

function isTodayInTz(iso, tz) {
  if (!iso) return false;
  return dateInTz(iso, tz) === dateInTz(new Date().toISOString(), tz);
}

function vslFromRow(row, answers) {
  const a = answers || row.answers || {};
  const v = a.vsl || (a._meta && a._meta.vsl) || {};
  return {
    vsl_page: !!v.page,
    vsl_started: !!v.started,
    vsl_offer_shown: !!v.offer_shown,
    vsl_seconds: parseInt(v.seconds, 10) || 0,
  };
}

function normalizeFromLead(row) {
  const meta = (row.answers && row.answers._meta) || {};
  const isProgress = row.source === 'almagemela_progress' ||
    String(row.email || '').endsWith('@progress.almagemela.local');
  const vsl = vslFromRow(row, row.answers);
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
    ...vsl,
  };
}

function normalizeFromSession(row) {
  return { ...row, storage: 'quiz_sessions', ...vslFromRow(row, row.answers) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();

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

  if (req.method === 'DELETE') {
    const body = parseBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: 'Nenhum lead selecionado' });
    }

    const deleted = [];
    const failed = [];

    for (const item of items) {
      const visitorId = String(item && item.visitor_id || '').trim().slice(0, 80);
      const leadId = String(item && item.id || '').trim().slice(0, 80);
      const storage = String(item && item.storage || '').trim();

      if (!visitorId && !leadId) {
        failed.push({ id: leadId || null, visitor_id: visitorId || null, reason: 'Identificador inválido' });
        continue;
      }

      try {
        let quizDeleted = false;
        let leadsDeleted = false;

        if (visitorId) {
          const quizRes = await fetch(
            `${supabaseUrl}/rest/v1/quiz_sessions?visitor_id=eq.${encodeURIComponent(visitorId)}`,
            { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' } }
          );
          if (!quizRes.ok) {
            const detail = await quizRes.text();
            if (!isMissingQuizSessions(quizRes.status, detail)) {
              throw new Error(`quiz_sessions: ${detail.slice(0, 160)}`);
            }
          } else {
            const quizRows = await quizRes.json().catch(() => []);
            quizDeleted = Array.isArray(quizRows) && quizRows.length > 0;
          }

          const email = sessionEmail(visitorId);
          const leadByEmailRes = await fetch(
            `${supabaseUrl}/rest/v1/leads?email=eq.${encodeURIComponent(email)}`,
            { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' } }
          );
          if (!leadByEmailRes.ok) {
            const detail = await leadByEmailRes.text();
            throw new Error(`leads email: ${detail.slice(0, 160)}`);
          }
          const leadRows = await leadByEmailRes.json().catch(() => []);
          leadsDeleted = Array.isArray(leadRows) && leadRows.length > 0;
        }

        if (!leadsDeleted && storage === 'leads' && leadId) {
          const leadByIdRes = await fetch(
            `${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`,
            { method: 'DELETE', headers: { ...headers, Prefer: 'return=representation' } }
          );
          if (!leadByIdRes.ok) {
            const detail = await leadByIdRes.text();
            throw new Error(`leads id: ${detail.slice(0, 160)}`);
          }
          const leadRows = await leadByIdRes.json().catch(() => []);
          leadsDeleted = Array.isArray(leadRows) && leadRows.length > 0;
        }

        deleted.push({
          id: leadId || null,
          visitor_id: visitorId || null,
          storage,
          quiz_sessions: quizDeleted,
          leads: leadsDeleted,
        });
      } catch (err) {
        failed.push({
          id: leadId || null,
          visitor_id: visitorId || null,
          reason: err && err.message ? err.message : 'Erro ao excluir',
        });
      }
    }

    return res.status(failed.length ? 207 : 200).json({
      ok: failed.length === 0,
      deleted_count: deleted.length,
      failed_count: failed.length,
      deleted,
      failed,
    });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

  const stats = {
    total: sessions.length,
    today: sessions.filter((r) => isTodayInTz(r.updated_at || r.created_at, ADMIN_TZ)).length,
    reading: sessions.filter((r) => r.status === 'reading' || (r.max_step || 0) >= 19).length,
    checkout: sessions.filter((r) => r.status === 'checkout').length,
    purchased: sessions.filter((r) => r.status === 'purchased').length,
    downsell: sessions.filter((r) => r.status === 'downsell').length,
    in_progress: sessions.filter((r) => r.status === 'in_progress' || r.status === 'started').length,
    vsl_play: sessions.filter((r) => r.vsl_started).length,
    vsl_offer: sessions.filter((r) => r.vsl_offer_shown).length,
  };

  return res.status(200).json({ ok: true, stats, sessions });
};
