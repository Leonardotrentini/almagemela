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
  const status = req.query.status ? String(req.query.status).trim() : '';
  const q = req.query.q ? String(req.query.q).trim() : '';

  let url = `${supabaseUrl}/rest/v1/quiz_sessions?select=*&order=updated_at.desc&limit=${limit}`;
  if (status) url += `&status=eq.${encodeURIComponent(status)}`;
  if (q) url += `&name=ilike.*${encodeURIComponent(q)}*`;

  try {
    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error('admin list error', response.status, errText);
      return res.status(502).json({
        error: 'Falha ao listar sessões. Rode o SQL de quiz_sessions no Supabase.',
        detail: errText.slice(0, 300),
      });
    }
    const rows = await response.json();

    const today = new Date().toISOString().slice(0, 10);
    const stats = {
      total: rows.length,
      today: rows.filter(r => String(r.created_at || '').startsWith(today)).length,
      reading: rows.filter(r => r.status === 'reading' || r.max_step >= 19).length,
      checkout: rows.filter(r => r.status === 'checkout' || r.status === 'purchased').length,
      downsell: rows.filter(r => r.status === 'downsell').length,
      in_progress: rows.filter(r => r.status === 'in_progress' || r.status === 'started').length,
    };

    return res.status(200).json({ ok: true, stats, sessions: rows });
  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};
