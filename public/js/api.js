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
  };
})();
