(function () {
  var VESTO_KEY = 'vpk_2b4dcce2b4ab82bd1b3c8b525ee85c0f';
  var ATTRIBUTION_URL = 'https://backend-production-7a466.up.railway.app/api/public/meta/attribution?key=' + encodeURIComponent(VESTO_KEY);
  var NEXT_SELLER_URL = '/api/next-seller';
  var FALLBACK_MSG = 'libera';
  var FALLBACK_PHONE = '558196738982';
  var BTN_LOADING = 'ABRIENDO WHATSAPP…';
  var busy = false;

  function isMobile() {
    return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
  }

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

  function waUrl(phone, message) {
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message || FALLBACK_MSG);
  }

  function getLabelEl(btn) {
    if (!btn) return null;
    return btn.querySelector('.btn-wa-label') || btn;
  }

  function setBtnLoading(btn, on) {
    if (!btn) return;
    var label = getLabelEl(btn);
    if (on) {
      if (!btn.dataset.vestoLabel) btn.dataset.vestoLabel = label.textContent;
      btn.classList.add('is-loading');
      btn.classList.remove('is-pressed');
      btn.setAttribute('aria-busy', 'true');
      label.textContent = BTN_LOADING;
    } else {
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
      if (btn.dataset.vestoLabel) label.textContent = btn.dataset.vestoLabel;
    }
  }

  function showLaunchOverlay(show) {
    var overlay = document.getElementById('wa-launch-overlay');
    if (!overlay) return;
    overlay.classList.toggle('visible', !!show);
    overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
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

  function openWhatsApp(phone, message, pendingWin) {
    var url = waUrl(phone, message);
    if (pendingWin && !pendingWin.closed) {
      try {
        pendingWin.location.replace(url);
        return;
      } catch (_) {}
    }
    if (isMobile()) {
      location.href = url;
      return;
    }
    var w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) location.href = url;
  }

  function handleWhatsAppClick(e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-vesto-whatsapp]');
    if (!btn || busy) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    busy = true;
    setBtnLoading(btn, true);
    if (isMobile()) showLaunchOverlay(true);

    var pendingWin = null;
    if (!isMobile()) {
      try { pendingWin = window.open('about:blank', '_blank'); } catch (_) {}
    }

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
        var phone = seller.phone ? String(seller.phone) : FALLBACK_PHONE;
        openWhatsApp(phone, seller.message || FALLBACK_MSG, pendingWin);
      })
      .catch(function (err) {
        console.error('[Vesto] Não foi possível obter o próximo vendedor.', err);
        if (pendingWin && !pendingWin.closed) {
          try { pendingWin.close(); } catch (_) {}
        }
        openWhatsApp(FALLBACK_PHONE, FALLBACK_MSG, null);
      })
      .finally(function () {
        if (!isMobile()) {
          setBtnLoading(btn, false);
          showLaunchOverlay(false);
          busy = false;
        }
      });
  }

  document.addEventListener('click', handleWhatsAppClick, true);

  document.addEventListener('touchstart', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-vesto-whatsapp]');
    if (!btn || btn.classList.contains('is-loading') || btn.classList.contains('hidden')) return;
    btn.classList.add('is-pressed');
  }, { passive: true });

  document.addEventListener('touchend', function () {
    document.querySelectorAll('[data-vesto-whatsapp].is-pressed').forEach(function (btn) {
      btn.classList.remove('is-pressed');
    });
  }, { passive: true });

  document.addEventListener('touchcancel', function () {
    document.querySelectorAll('[data-vesto-whatsapp].is-pressed').forEach(function (btn) {
      btn.classList.remove('is-pressed');
    });
  }, { passive: true });
})();
