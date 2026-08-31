// === TRACKING UTILS - Anti re-fire + Event ID ===
(function (w) {
  function newEventId() {
    try {
      if (w.crypto && typeof w.crypto.randomUUID === 'function') {
        return w.crypto.randomUUID();
      }
    } catch (e) {}
    return 'ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  w.trackOnce = function trackOnce(eventName, params, eventIdOverride) {
    params = params || {};
    var key = 'fb_fired_' + eventName;
    try {
      if (w.sessionStorage.getItem(key)) return null;
    } catch (e) {}
    var eventId = eventIdOverride || newEventId();
    if (typeof w.fbq === 'function') {
      w.fbq('track', eventName, params, { eventID: eventId });
    }
    try {
      w.sessionStorage.setItem(key, eventId);
    } catch (e) {}
    return eventId;
  };

  w.trackOnceCustom = function trackOnceCustom(eventName, params, eventIdOverride) {
    params = params || {};
    var key = 'fb_fired_custom_' + eventName;
    try {
      if (w.sessionStorage.getItem(key)) return null;
    } catch (e) {}
    var eventId = eventIdOverride || newEventId();
    if (typeof w.fbq === 'function') {
      w.fbq('trackCustom', eventName, params, { eventID: eventId });
    }
    try {
      w.sessionStorage.setItem(key, eventId);
    } catch (e) {}
    return eventId;
  };

  w.waitForPixel = function waitForPixel(callback) {
    if (typeof w.fbq === 'function' && w.fbq.loaded) {
      callback();
    } else {
      setTimeout(function () { waitForPixel(callback); }, 100);
    }
  };

  w.trackInitiateCheckout = function trackInitiateCheckout(params, eventIdOverride) {
    try {
      if (!w.sessionStorage.getItem('fb_fired_Lead')) return null;
    } catch (e) {
      return null;
    }
    return w.trackOnce('InitiateCheckout', params || {}, eventIdOverride);
  };

  w.trackPurchase = function trackPurchase(params, eventIdOverride) {
    try {
      if (!w.sessionStorage.getItem('fb_fired_InitiateCheckout')) return null;
    } catch (e) {
      return null;
    }
    return w.trackOnce('Purchase', params || {}, eventIdOverride);
  };
})(window);
