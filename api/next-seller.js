const VESTO_KEY = 'vpk_2b4dcce2b4ab82bd1b3c8b525ee85c0f';
const VESTO_CONFIG_URL =
  'https://backend-production-7a466.up.railway.app/api/public/meta/config?key=' +
  encodeURIComponent(VESTO_KEY);
const WA_MESSAGE = 'mi carta secreta';

const DEFAULT_SELLERS = [{ label: 'Martha', phone: '558196738982' }];
const FALLBACK_PHONE = DEFAULT_SELLERS[0].phone;
const FALLBACK_LABEL = DEFAULT_SELLERS[0].label;

function sellerResponse(res, seller, index, total, seq, extra) {
  return res.status(200).json({
    ok: true,
    phone: seller.phone,
    label: seller.label,
    index,
    total,
    seq,
    message: WA_MESSAGE,
    ...(extra || {}),
  });
}

let sellersCache = { list: DEFAULT_SELLERS, at: 0 };
const SELLERS_TTL_MS = 5 * 60 * 1000;

function getSupabaseConfig() {
  const supabaseUrl = (
    process.env.ALMAGEMELA_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim().replace(/\/$/, '');
  const supabaseKey = (process.env.ALMAGEMELA_SUPABASE_SECRET_KEY || '').trim();
  return { supabaseUrl, supabaseKey };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
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

function normalizeSellers(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw
    .map((s) => ({
      label: String(s.label || s.name || '').trim(),
      phone: String(s.phone || s.whatsapp || '').replace(/\D/g, ''),
    }))
    .filter((s) => s.phone.length >= 10);
  return list.length ? list : null;
}

async function loadSellers() {
  const now = Date.now();
  if (sellersCache.list.length && now - sellersCache.at < SELLERS_TTL_MS) {
    return sellersCache.list;
  }

  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 3500) : null;
    const res = await fetch(VESTO_CONFIG_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) throw new Error('vesto_config_' + res.status);
    const data = await res.json();
    const fromConfig =
      normalizeSellers(data.sellers) ||
      normalizeSellers(data.whatsapp_sellers) ||
      normalizeSellers(data.vendedores);
    if (fromConfig) {
      sellersCache = { list: fromConfig, at: now };
      return fromConfig;
    }
  } catch (_) {}

  sellersCache = { list: DEFAULT_SELLERS, at: now };
  return DEFAULT_SELLERS;
}

async function nextSeq(supabaseUrl, supabaseKey) {
  const rpc = await sbFetch(supabaseUrl, supabaseKey, 'rpc/next_seller_seq', {
    method: 'POST',
    body: '{}',
  });
  if (rpc.ok) {
    const seq = await rpc.json();
    const n = parseInt(seq, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const getRes = await sbFetch(
    supabaseUrl,
    supabaseKey,
    'seller_counter?id=eq.global&select=seq&limit=1'
  );
  if (!getRes.ok) throw new Error('seller_counter_read');
  const rows = await getRes.json();
  const prev = parseInt(rows && rows[0] && rows[0].seq, 10) || 0;
  const next = prev + 1;
  const patchRes = await sbFetch(
    supabaseUrl,
    supabaseKey,
    'seller_counter?id=eq.global',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ seq: next }),
    }
  );
  if (!patchRes.ok) throw new Error('seller_counter_write');
  const patched = await patchRes.json();
  const saved = parseInt(patched && patched[0] && patched[0].seq, 10);
  return saved > 0 ? saved : next;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Supabase não configurado' });
  }

  try {
    const sellers = await loadSellers();
    const seq = await nextSeq(supabaseUrl, supabaseKey);
    const index = (seq - 1) % sellers.length;
    const seller = sellers[index];

    return sellerResponse(res, seller, index, sellers.length, seq);
  } catch (err) {
    console.error('[next-seller]', err);
    return sellerResponse(res, DEFAULT_SELLERS[0], 0, 1, 0, { fallback: true });
  }
};
