(function () {
  var VESTO_KEY = 'vpk_2b4dcce2b4ab82bd1b3c8b525ee85c0f';
  var ATTRIBUTION_URL = 'https://backend-production-7a466.up.railway.app/api/public/meta/attribution?key=' + encodeURIComponent(VESTO_KEY);
  var NEXT_SELLER_URL = '/api/next-seller';
  var FALLBACK_MSG = 'mi carta secreta';
  var busy = false;

  function buildRef() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var suffix = '';
    for (var i = 0; i < 8; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'vst_' + suffix;
  }

  function readMeta() {
    try { return JSON.parse(sessionStorage.getItem('vesto_meta') || '{}'); } catch (_) { return {}; }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function sendAttribution(meta, ref, contactEventId) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 4000) : null;
    return fetch(ATTRIBUTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vesto-Key': VESTO_KEY },
      body: JSON.stringify({
        vestoPublicKey: VESTO_KEY,
        ref: ref,
        contactEventId: contactEventId,
        fbclid: meta.fbclid || null,
        fbc: meta.fbc || null,
        fbp: meta.fbp || null,
        clickAt: meta.clickAt,
        pageUrl: meta.pageUrl,
        userAgent: meta.userAgent,
        utm_source: meta.utm_source || '',
        utm_medium: meta.utm_medium || '',
        utm_campaign: meta.utm_campaign || '',
        utm_content: meta.utm_content || '',
        utm_term: meta.utm_term || '',
      }),
      credentials: 'omit',
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('vesto_attribution_' + res.status);
        return res.json();
      })
      .catch(function () { return null; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function nextSeller() {
    return fetch(NEXT_SELLER_URL, { method: 'GET', cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('next_seller_' + res.status);
        return res.json();
      });
  }

  function openWhatsApp(phone, message) {
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(message || FALLBACK_MSG), '_blank', 'noopener,noreferrer');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-vesto-whatsapp]');
    if (!btn || busy) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    busy = true;
    var meta = readMeta();
    meta.clickAt = Date.now();
    meta.pageUrl = location.href;
    meta.userAgent = navigator.userAgent || '';
    var ref = buildRef();
    var contactEventId = 'vst_contact_' + ref.toLowerCase();
    try { sessionStorage.setItem('vesto_ref', ref); } catch (_) {}
    try { sessionStorage.setItem('vesto_contact_event_id', contactEventId); } catch (_) {}
    if (typeof fbq === 'function') {
      fbq('track', 'Contact', {}, { eventID: contactEventId });
    }
    var attributionWait = Promise.race([
      sendAttribution(meta, ref, contactEventId),
      wait(2500),
    ]);
    Promise.all([nextSeller(), attributionWait])
      .then(function (results) {
        var seller = results[0] || {};
        var phone = seller.phone ? String(seller.phone) : '';
        if (!phone) return;
        openWhatsApp(phone, seller.message || FALLBACK_MSG);
      })
      .catch(function (err) {
        console.error('[Vesto] Não foi possível obter o próximo vendedor.', err);
      })
      .finally(function () { busy = false; });
  }, true);
})();
