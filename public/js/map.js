/* ==========================================================
   MapKit — طبقة الخرائط بستايل أوبر
   - خريطة أساس هادئة: رمادي فاتح وطرق بيضاء نهاراً، فحمي داكن ليلاً
   - خط مسار أسود سميك (أبيض ليلاً) يُرسم بحركة
   - نقطة انطلاق دائرية ووجهة مربّعة، مع بطاقات صغيرة عليها
   - سيارات من الأعلى تدور حسب اتجاه السير
   - دبوس تحديد يرتفع أثناء السحب ويهبط عند التثبيت
   المزوّد قابل للتبديل من الإعدادات (بلاطات / بحث / مسارات).
   ========================================================== */
window.MapKit = (function () {
  let cfg = {
    tilesUrl: '',
    tilesUrlDark: '',
    geocoderUrl: 'https://nominatim.openstreetmap.org',
    routingUrl: 'https://router.project-osrm.org',
  };
  const KARAK = { lat: 31.1850, lng: 35.7047 };
  const DEFAULT_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const DEFAULT_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function configure(c) {
    for (const k of Object.keys(c || {})) if (c[k]) cfg[k] = c[k];
  }

  const tileUrl = () => (isDark() ? cfg.tilesUrlDark || DEFAULT_DARK : cfg.tilesUrl || DEFAULT_LIGHT);

  /* ----------------------------- إنشاء خريطة ----------------------------- */
  function create(node, { center = KARAK, zoom = 15, interactive = true } = {}) {
    const map = L.map(node, {
      center: [center.lat, center.lng], zoom,
      zoomControl: false, attributionControl: false,
      zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
      dragging: interactive, scrollWheelZoom: interactive,
      doubleClickZoom: interactive, touchZoom: interactive, boxZoom: false, keyboard: interactive,
      fadeAnimation: true, zoomAnimation: true, markerZoomAnimation: true,
    });
    node.classList.add('map--uber');

    const layer = L.tileLayer(tileUrl(), {
      maxZoom: 19, subdomains: 'abcd', detectRetina: true, className: 'map-tiles',
    }).addTo(map);

    L.control.attribution({ position: 'topleft', prefix: false })
      .addAttribution('&copy; OpenStreetMap &copy; CARTO')
      .addTo(map);

    // تبديل الخريطة مع الوضع الليلي فوراً
    const observer = new MutationObserver(() => {
      layer.setUrl(tileUrl());
      map.fire('themechange');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    map.on('unload', () => observer.disconnect());
    return map;
  }

  /* ------------------------------- العلامات ------------------------------- */
  function divIcon(html, size, anchor, cls = '') {
    return L.divIcon({ className: 'mk ' + cls, html, iconSize: size, iconAnchor: anchor });
  }

  /** نقطة الانطلاق: دائرة سوداء بقلب أبيض — مع بطاقة اختيارية */
  function pickupIcon(label) {
    return divIcon(
      `<div class="mk-stop mk-stop--pickup"><span></span></div>${label ? `<div class="mk-chip">${esc(label)}</div>` : ''}`,
      [18, 18], [9, 9], 'mk--pickup');
  }

  /** الوجهة: مربّع أسود بقلب أبيض — مع بطاقة اختيارية */
  function destIcon(label) {
    return divIcon(
      `<div class="mk-stop mk-stop--dest"><span></span></div>${label ? `<div class="mk-chip">${esc(label)}</div>` : ''}`,
      [18, 18], [9, 9], 'mk--dest');
  }

  /** نقطة موقعي: أزرق مع نبض خفيف */
  const meIcon = () => divIcon('<div class="mk-me"><i></i></div>', [22, 22], [11, 11]);

  /** سيارة من الأعلى — تدور حسب الاتجاه */
  const CAR_SVG = `
    <svg viewBox="0 0 40 72" width="22" height="40" aria-hidden="true">
      <rect x="4" y="3" width="32" height="66" rx="13" fill="var(--car-body)" stroke="var(--car-edge)" stroke-width="2"/>
      <path d="M9 22 Q20 16 31 22 L29 31 Q20 28 11 31 Z" fill="var(--car-glass)"/>
      <path d="M11 52 Q20 55 29 52 L30 60 Q20 63 10 60 Z" fill="var(--car-glass)"/>
      <rect x="10" y="33" width="20" height="17" rx="4" fill="var(--car-roof)"/>
    </svg>`;
  function carIcon(heading = 0) {
    return divIcon(`<div class="mk-car" style="transform:rotate(${Number(heading) || 0}deg)">${CAR_SVG}</div>`, [40, 40], [20, 20], 'mk--car');
  }

  function carMarker(map, pos, heading) {
    const m = L.marker([pos.lat, pos.lng], { icon: carIcon(heading), zIndexOffset: 500, keyboard: false }).addTo(map);
    m._heading = heading || 0;
    /** تحريك السيارة بنعومة إلى موقع جديد */
    m.glideTo = (next, nextHeading) => {
      const from = m.getLatLng();
      const to = L.latLng(next.lat, next.lng);
      const h = nextHeading ?? bearing(from, to) ?? m._heading;
      const el = m.getElement() && m.getElement().querySelector('.mk-car');
      if (el) el.style.transform = `rotate(${h}deg)`;
      m._heading = h;
      if (reduceMotion()) return m.setLatLng(to);
      const t0 = performance.now(), dur = 1400;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        m.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    return m;
  }

  function bearing(a, b) {
    if (!a || !b || (a.lat === b.lat && a.lng === b.lng)) return null;
    const r = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  /* -------------------------------- المسار -------------------------------- */
  /** مسار الطريق الحقيقي من مزوّد المسارات؛ عند التعذّر يُرسم قوس تقريبي منقّط */
  async function fetchRoute(a, b) {
    const url = `${cfg.routingUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const data = await res.json();
      const r = data.routes && data.routes[0];
      if (!r) return null;
      return {
        coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        exact: true,
      };
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function arc(a, b, n = 48) {
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const dx = b.lng - a.lng, dy = b.lat - a.lat;
    const ctrl = { lat: mid.lat + dx * 0.22, lng: mid.lng - dy * 0.22 };
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * a.lat + 2 * u * t * ctrl.lat + t * t * b.lat, u * u * a.lng + 2 * u * t * ctrl.lng + t * t * b.lng]);
    }
    return pts;
  }

  /**
   * يرسم المسار بستايل أوبر ويعيد معلوماته.
   * @returns {Promise<{remove:Function, exact:boolean, distanceM?:number, durationS?:number, bounds:L.LatLngBounds}>}
   */
  async function route(map, a, b, { animate = true } = {}) {
    const found = await fetchRoute(a, b);
    const coords = found ? found.coords : arc(a, b);
    const exact = Boolean(found);

    const ink = () => cssVar('--map-ink') || '#111418';
    const paper = () => cssVar('--map-paper') || '#ffffff';

    const casing = L.polyline([], { color: paper(), weight: 10, opacity: exact ? 1 : 0, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    const line = L.polyline([], {
      color: ink(), weight: exact ? 5 : 3.5, opacity: exact ? 1 : .8,
      dashArray: exact ? null : '2 9', lineCap: 'round', lineJoin: 'round', interactive: false,
    }).addTo(map);

    const onTheme = () => { casing.setStyle({ color: paper() }); line.setStyle({ color: ink() }); };
    map.on('themechange', onTheme);

    if (!animate || reduceMotion()) {
      casing.setLatLngs(coords); line.setLatLngs(coords);
    } else {
      const t0 = performance.now(), dur = 850;
      await new Promise((resolve) => {
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          const n = Math.max(2, Math.ceil(coords.length * e));
          const part = coords.slice(0, n);
          casing.setLatLngs(part); line.setLatLngs(part);
          if (k < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
    }

    return {
      exact,
      distanceM: found ? found.distanceM : undefined,
      durationS: found ? found.durationS : undefined,
      bounds: L.latLngBounds(coords),
      remove() { map.off('themechange', onTheme); casing.remove(); line.remove(); },
    };
  }

  /* -------------------------------- الكاميرا -------------------------------- */
  /** ضبط الإطار مع ترك مساحة للّوح السفلي حتى لا يغطي المسار */
  function frame(map, pointsOrBounds, { sheet = 0, top = 90, side = 48, maxZoom = 16.5 } = {}) {
    const b = pointsOrBounds instanceof L.LatLngBounds
      ? pointsOrBounds
      : L.latLngBounds(pointsOrBounds.map((p) => [p.lat, p.lng]));
    const opts = { paddingTopLeft: [side, top], paddingBottomRight: [side, sheet + 32], maxZoom };
    if (reduceMotion()) map.fitBounds(b, opts);
    else map.flyToBounds(b, { ...opts, duration: .8, easeLinearity: .2 });
  }

  /** ارتفاع اللوح السفلي داخل الشاشة لاستخدامه في ضبط الإطار */
  function sheetHeight(screen) {
    const s = screen && screen.querySelector('.sheet, .dock');
    return s ? s.getBoundingClientRect().height : 0;
  }

  /* ------------------------ الدبوس الثابت في المنتصف ------------------------ */
  function centerPin(label = '') {
    const node = document.createElement('div');
    node.className = 'center-pin';
    node.innerHTML = `
      <div class="center-pin__chip">${esc(label)}</div>
      <div class="center-pin__head"><span></span></div>
      <div class="center-pin__stick"></div>
      <div class="center-pin__shadow"></div>`;
    return {
      node,
      lift(on) { node.classList.toggle('is-lifted', on); },
      label(text) {
        const c = node.querySelector('.center-pin__chip');
        c.textContent = text || '';
        c.classList.toggle('hidden', !text);
      },
    };
  }

  /** ربط الدبوس بحركة الخريطة: يرتفع أثناء السحب ويهبط عند التوقف */
  function bindCenterPin(map, pin, onSettle) {
    let t = null;
    map.on('movestart', () => { pin.lift(true); clearTimeout(t); });
    map.on('moveend', () => {
      pin.lift(false);
      clearTimeout(t);
      t = setTimeout(() => onSettle(map.getCenter()), 220);
    });
  }

  /* ------------------------------ الموقع والبحث ------------------------------ */
  function locate({ timeout = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('المتصفح لا يدعم تحديد الموقع'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading }),
        (err) => reject(new Error(
          err.code === 1 ? 'تم رفض إذن الموقع. فعّله من إعدادات المتصفح'
          : err.code === 3 ? 'انتهت مهلة تحديد الموقع'
          : 'تعذّر تحديد موقعك'
        )),
        { enableHighAccuracy: true, timeout, maximumAge: 15000 }
      );
    });
  }

  async function search(q) {
    const url = `${cfg.geocoderUrl}/search?format=jsonv2&accept-language=ar&limit=8&countrycodes=jo&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('تعذّر البحث عن العنوان حالياً');
    const rows = await res.json();
    return rows.map((r) => ({
      label: (r.name || r.display_name.split(',')[0]).trim(),
      address: r.display_name,
      lat: Number(r.lat), lng: Number(r.lon),
    }));
  }

  async function reverse(lat, lng) {
    const url = `${cfg.geocoderUrl}/reverse?format=jsonv2&accept-language=ar&lat=${lat}&lon=${lng}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const r = await res.json();
      const a = r.address || {};
      const short = [a.road || a.neighbourhood || a.suburb, a.city || a.town || a.village].filter(Boolean).join('، ');
      return { label: short || (r.display_name || '').split(',').slice(0, 2).join('، '), address: r.display_name };
    } catch { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    KARAK, configure, create,
    pickupIcon, destIcon, meIcon, carIcon, carMarker,
    route, frame, sheetHeight, centerPin, bindCenterPin,
    locate, search, reverse, bearing,
  };
})();
