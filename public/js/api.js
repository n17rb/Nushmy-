/* طبقة الاتصال بالخادم — تجديد تلقائي للجلسة، وأخطاء مفهومة. */
window.API = (function () {
  let accessToken = null;
  let refreshing = null;

  const setToken = (t) => { accessToken = t; };
  const getToken = () => accessToken;

  class ApiError extends Error {
    constructor(code, message, status) { super(message); this.code = code; this.status = status; }
  }

  async function raw(path, { method = 'GET', body, auth = true, retry = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = 'Bearer ' + accessToken;

    let res;
    try {
      res = await fetch(path, {
        method, headers, credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('NETWORK', 'لا يوجد اتصال بالإنترنت. تحقق من الشبكة وحاول مرة أخرى', 0);
    }

    let data = null;
    try { data = await res.json(); } catch { data = null; }

    if (res.status === 401 && auth && retry) {
      const ok = await tryRefresh();
      if (ok) return raw(path, { method, body, auth, retry: false });
    }
    if (!res.ok || (data && data.ok === false)) {
      const err = (data && data.error) || {};
      throw new ApiError(err.code || 'UNKNOWN', err.message || 'تعذّر تنفيذ الطلب', res.status);
    }
    return data;
  }

  function tryRefresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const d = await raw('/api/auth/refresh', { method: 'POST', auth: false, retry: false });
        accessToken = d.accessToken;
        return true;
      } catch { accessToken = null; return false; }
      finally { refreshing = null; }
    })();
    return refreshing;
  }

  return {
    ApiError, setToken, getToken, tryRefresh,
    get:   (p, o)    => raw(p, { ...o, method: 'GET' }),
    post:  (p, b, o) => raw(p, { ...o, method: 'POST', body: b === undefined ? {} : b }),
    patch: (p, b, o) => raw(p, { ...o, method: 'PATCH', body: b }),
    del:   (p, o)    => raw(p, { ...o, method: 'DELETE' }),

    config:        ()   => raw('/api/config', { auth: false }),
    requestOtp:    (phone) => raw('/api/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),
    verifyOtp:     (phone, code) => raw('/api/auth/otp/verify', { method: 'POST', body: { phone, code }, auth: false }),
    logout:        ()   => raw('/api/auth/logout', { method: 'POST', auth: false }),
    me:            ()   => raw('/api/me'),
    updateMe:      (b)  => raw('/api/me', { method: 'PATCH', body: b }),
    uploadPhoto:   (dataUrl) => raw('/api/me/photo', { method: 'POST', body: { dataUrl } }),
    removePhoto:   ()   => raw('/api/me/photo', { method: 'DELETE' }),
    places:        ()   => raw('/api/places'),
    savePlace:     (b)  => raw('/api/places', { method: 'POST', body: b }),
    deletePlace:   (id) => raw('/api/places/' + id, { method: 'DELETE' }),
    vehicleTypes:  ()   => raw('/api/vehicle-types', { auth: false }),
    nearbyCaptains:(lat, lng) => raw(`/api/captains/nearby?lat=${lat}&lng=${lng}`),
    estimate:      (b)  => raw('/api/trips/estimate', { method: 'POST', body: b }),
    createTrip:    (b)  => raw('/api/trips', { method: 'POST', body: b }),
    activeTrip:    ()   => raw('/api/trips/active'),
    trip:          (id) => raw('/api/trips/' + id),
    tripHistory:   ()   => raw('/api/trips/history'),
    cancelPreview: (id) => raw('/api/trips/' + id + '/cancel-preview'),
    cancelTrip:    (id, reason) => raw('/api/trips/' + id + '/cancel', { method: 'POST', body: { reason } }),
    rateTrip:      (id, b) => raw('/api/trips/' + id + '/rate', { method: 'POST', body: b }),

    // ----- تطبيق الكابتن -----
    cap: {
      me:        ()        => raw('/api/captain/me'),
      register:  (b)       => raw('/api/captain/register', { method: 'POST', body: b }),
      document:  (kind, dataUrl) => raw('/api/captain/documents', { method: 'POST', body: { kind, dataUrl } }),
      goal:      (goalFils) => raw('/api/captain/goal', { method: 'PATCH', body: { goalFils } }),
      online:    (online)  => raw('/api/captain/online', { method: 'POST', body: { online } }),
      location:  (b)       => raw('/api/captain/location', { method: 'POST', body: b }),
      offer:     ()        => raw('/api/captain/offer'),
      accept:    (id)      => raw('/api/captain/offers/' + id + '/accept', { method: 'POST', body: {} }),
      reject:    (id)      => raw('/api/captain/offers/' + id + '/reject', { method: 'POST', body: {} }),
      activeTrip:()        => raw('/api/captain/trip'),
      trip:      (id)      => raw('/api/captain/trips/' + id),
      arrived:   (id)      => raw('/api/captain/trips/' + id + '/arrived', { method: 'POST', body: {} }),
      start:     (id)      => raw('/api/captain/trips/' + id + '/start', { method: 'POST', body: {} }),
      complete:  (id)      => raw('/api/captain/trips/' + id + '/complete', { method: 'POST', body: {} }),
      cancel:    (id, b)   => raw('/api/captain/trips/' + id + '/cancel', { method: 'POST', body: b }),
      rate:      (id, stars) => raw('/api/captain/trips/' + id + '/rate', { method: 'POST', body: { stars } }),
      earnings:  (range)   => raw('/api/captain/earnings?range=' + (range || 'today')),
      wallet:    ()        => raw('/api/captain/wallet'),
      deposit:   (amountFils, proofDataUrl) => raw('/api/captain/wallet/deposits', { method: 'POST', body: { amountFils, proofDataUrl } }),
    },
  };
})();
