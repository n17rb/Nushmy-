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
    tilesStyle: 'osm',
    attribution: '&copy; OpenStreetMap',
    geocoderUrl: 'https://nominatim.openstreetmap.org',
    photonUrl: 'https://photon.komoot.io',
    routingUrl: 'https://router.project-osrm.org',
  };
  const KARAK = { lat: 31.1850, lng: 35.7047 };
  // بدون مفتاح: OpenStreetMap (CARTO صارت تطلب مفتاح وتكتب «API KEY REQUIRED» على الخريطة)
  const DEFAULT_LIGHT = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const DEFAULT_DARK  = DEFAULT_LIGHT;

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
    node.classList.add('map--uber', 'tiles--' + (cfg.tilesStyle || 'osm'));

    const layer = L.tileLayer(tileUrl(), {
      maxZoom: 19, maxNativeZoom: 19, subdomains: 'abcd', className: 'map-tiles',
      // OSM ما عندها بلاطات Retina؛ منطلب زوم أعلى بدرجة على الشاشات الحادة حتى تضل الكتابة واضحة
      detectRetina: cfg.tilesStyle !== 'osm',
    }).addTo(map);

    L.control.attribution({ position: 'topleft', prefix: false })
      .addAttribution(cfg.attribution || '&copy; OpenStreetMap')
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

  /**
   * تحديد موقع دقيق: بنراقب GPS لعدة ثواني وبناخذ أدق قراءة (أول قراءة غالباً من الشبكة وبتكون بعيدة 50–500 م).
   * بيوقف أول ما توصل الدقة لـ `goodM` متر أو بعد `maxMs`.
   * @returns {Promise<{lat,lng,accuracy}>}
   */
  function locatePrecise({ goodM = 15, maxMs = 7000, onUpdate } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('المتصفح لا يدعم تحديد الموقع'));
      let best = null, done = false;
      const finish = () => {
        if (done) return; done = true;
        navigator.geolocation.clearWatch(id); clearTimeout(t);
        best ? resolve(best) : reject(new Error('تعذّر تحديد موقعك بدقة. فعّل الـ GPS وجرّب'));
      };
      const id = navigator.geolocation.watchPosition((p) => {
        const r = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), heading: p.coords.heading };
        if (!best || r.accuracy <= best.accuracy) { best = r; onUpdate && onUpdate(r); }
        if (r.accuracy <= goodM) finish();
      }, (err) => {
        if (best) return finish();
        done = true; navigator.geolocation.clearWatch(id); clearTimeout(t);
        reject(new Error(err.code === 1 ? 'تم رفض إذن الموقع. فعّله من إعدادات المتصفح' : 'تعذّر تحديد موقعك'));
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs });
      const t = setTimeout(finish, maxMs);
    });
  }

  /** دائرة الدقة حول نقطتي (قد إيش GPS متأكد) */
  function accuracyCircle(map, pos) {
    return L.circle([pos.lat, pos.lng], { radius: pos.accuracy || 30, color: '#2F7BF6', weight: 1, opacity: .5, fillColor: '#2F7BF6', fillOpacity: .12, interactive: false }).addTo(map);
  }

  /* ---------------------------- البحث المحسّن ----------------------------
     3 مصادر مع بعض، والنتائج مرتبة حسب التطابق والقرب:
       1) أماكن نشمي (الي ضافتها الإدارة + وجهات الزباين السابقة)
       2) Photon — بحث ذكي بيلاقي المحلات والمطاعم والشركات وبيتحمّل الأخطاء
       3) Nominatim — عناوين وشوارع ومناطق
     «عبدلي» = «العبدلي»، «مكه» = «مكة»، «ابو» = «أبو» (نفس دالة الخادم src/lib/arabic.js) */
  const DIG = '٠١٢٣٤٥٦٧٨٩';
  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[٠-٩]/g, (d) => String(DIG.indexOf(d)))
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/).filter(Boolean)
      .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
      .map((w) => (w.length > 4 && /^[وب]ال/.test(w) ? w.slice(3) : w))
      .join(' ');
  }
  function matchScore(query, name) {
    const q = normalize(query), n = normalize(name);
    if (!q || !n) return 0;
    if (n === q) return 1;
    if (n.startsWith(q)) return 0.92;
    const words = n.split(' ');
    if (words.some((w) => w.startsWith(q))) return 0.85;
    if (n.includes(q)) return 0.75;
    const qw = q.split(' ');
    const hits = qw.filter((w) => words.some((x) => x.startsWith(w) || (w.length > 3 && x.includes(w)))).length;
    return hits ? 0.4 + 0.3 * (hits / qw.length) : 0;
  }
  const isArabic = (s) => /[\u0600-\u06FF]/.test(s);

  /** صيغ إضافية للبحث: «عبدلي» ← «العبدلي» (الخرائط بتكتب الاسم مع «ال») */
  function variants(q) {
    const out = [q.trim()];
    if (isArabic(q)) {
      const words = q.trim().split(/\s+/);
      if (!/^ال/.test(words[0])) out.push(['ال' + words[0], ...words.slice(1)].join(' '));
      if (words.length > 1 && !/^ال/.test(words[words.length - 1])) out.push([...words.slice(0, -1), 'ال' + words[words.length - 1]].join(' '));
      const plain = q.replace(/[أإآ]/g, 'ا').replace(/ه$/, 'ة');
      if (plain !== q) out.push(plain);
    }
    return [...new Set(out)].slice(0, 3);
  }

  const JO_BOX = '34.85,29.15,39.35,33.40';   // حدود الأردن
  const CATEGORY = {
    shop: 'محل', supermarket: 'سوبرماركت', convenience: 'بقالة', bakery: 'مخبز', mall: 'مول', clothes: 'ملابس',
    restaurant: 'مطعم', cafe: 'كافيه', fast_food: 'وجبات سريعة', fuel: 'محطة وقود', pharmacy: 'صيدلية',
    hospital: 'مستشفى', clinic: 'عيادة', doctors: 'عيادة', school: 'مدرسة', university: 'جامعة', college: 'كلية',
    bank: 'بنك', atm: 'صراف', place_of_worship: 'مسجد', mosque: 'مسجد', police: 'شرطة', townhall: 'بلدية',
    hotel: 'فندق', bus_station: 'مجمّع', parking: 'موقف', park: 'حديقة', stadium: 'ملعب', attraction: 'معلم',
    castle: 'قلعة', office: 'مكتب', company: 'شركة', government: 'دائرة حكومية', car_repair: 'كراج',
    city: 'مدينة', town: 'بلدة', village: 'قرية', suburb: 'حي', neighbourhood: 'حي', residential: 'شارع',
    primary: 'شارع', secondary: 'شارع', tertiary: 'شارع', road: 'شارع', place: 'مكان', used: 'مطلوب قبل',
  };
  const catLabel = (k, v) => CATEGORY[v] || CATEGORY[k] || '';

  async function getJson(url, ms = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      return res.ok ? await res.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  async function photon(q, near) {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.4` : '';
    const data = await getJson(`${cfg.photonUrl}/api/?q=${encodeURIComponent(q)}&limit=10&bbox=${JO_BOX}${bias}`);
    return ((data && data.features) || []).map((f) => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry.coordinates;
      const place = [p.street, p.district || p.locality, p.city || p.county].filter(Boolean);
      return {
        label: p.name || p.street || '', address: [...new Set(place)].join('، '),
        lat, lng, category: catLabel(p.osm_key, p.osm_value), src: 'photon',
      };
    }).filter((r) => r.label);
  }

  async function nominatim(q, near) {
    const vb = near ? `&viewbox=${near.lng - 0.35},${near.lat + 0.3},${near.lng + 0.35},${near.lat - 0.3}` : '';
    const rows = await getJson(`${cfg.geocoderUrl}/search?format=jsonv2&accept-language=ar&limit=8&countrycodes=jo&namedetails=1${vb}&q=${encodeURIComponent(q)}`);
    return (rows || []).map((r) => ({
      label: ((r.namedetails && (r.namedetails['name:ar'] || r.namedetails.name)) || r.name || r.display_name.split(',')[0]).trim(),
      address: r.display_name.split(',').slice(1, 4).join('،').trim(),
      lat: Number(r.lat), lng: Number(r.lon), category: catLabel(r.category, r.type), src: 'osm',
    }));
  }

  function distM(a, b) {
    const r = Math.PI / 180, R = 6371000;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * @param {string} q نص البحث
   * @param {{lat:number,lng:number}} [near] مكان الزبون — النتائج القريبة أول
   */
  async function search(q, near) {
    const list = variants(q);
    const local = window.API && API.searchPlaces ? API.searchPlaces(q, near).then((r) => r.results || []).catch(() => []) : Promise.resolve([]);
    const jobs = [local, ...list.map((v) => photon(v, near)), ...list.slice(0, 2).map((v) => nominatim(v, near))];
    const all = (await Promise.all(jobs)).flat();
    if (!all.length && !navigator.onLine) throw new Error('ما في إنترنت. تأكد من الاتصال وجرّب');

    const out = [];
    for (const r of all) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      const text = Math.max(matchScore(q, r.label), matchScore(q, r.address) * 0.7);
      let score = (r.source === 'nashmi' ? (r.score || text) + 0.1 : text);
      if (r.category && r.category !== 'شارع') score += 0.04;          // محلات وأماكن قبل الشوارع
      const d = near ? distM(near, r) : null;
      if (d != null) score -= Math.min(0.3, d / 150000);                // الأقرب أول
      const dup = out.find((x) => distM(x, r) < 80 && normalize(x.label) === normalize(r.label));
      if (dup) { if (score > dup.score) Object.assign(dup, r, { score, distanceM: d }); continue; }
      out.push({ ...r, score, distanceM: d == null ? undefined : Math.round(d) });
    }
    return out.filter((r) => r.score > 0.12).sort((a, b) => b.score - a.score).slice(0, 10);
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
    locate, search, reverse, bearing, normalize, matchScore, distM, routeInfo: fetchRoute, locatePrecise, accuracyCircle,
  };
})();
