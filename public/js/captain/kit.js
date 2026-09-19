/* ==========================================================
   أدوات تطبيق الكابتن: الموقع المباشر، إبقاء الشاشة مضاءة، صوت الطلب،
   زر «اسحب للتأكيد»، وفتح الملاحة في Google Maps أو Waze.
   ========================================================== */
window.CapKit = (function () {
  const { el, esc } = UI;

  /* ------------------------------ الموقع المباشر ------------------------------ */
  const Location = (() => {
    let watchId = null, heartbeat = null, last = null, lastSent = 0, lastSentPos = null;
    const listeners = new Set();

    function send(force = false) {
      if (!last) return;
      const now = Date.now();
      const moved = lastSentPos ? distance(lastSentPos, last) : Infinity;
      if (!force && now - lastSent < 4000 && moved < 25) return;
      lastSent = now; lastSentPos = { ...last };
      API.cap.location(last).catch(() => { /* نعيد بالنبضة القادمة */ });
    }

    function onPos(p) {
      const next = {
        lat: p.coords.latitude, lng: p.coords.longitude,
        accuracy: Math.round(p.coords.accuracy || 0),
        speed: p.coords.speed, heading: p.coords.heading,
      };
      // عند الوقوف المتصفح ما بيعطي اتجاه — نحسبه من آخر حركة
      if ((next.heading === null || Number.isNaN(next.heading)) && last && distance(last, next) > 6) {
        next.heading = Math.round(MapKit.bearing(last, next));
      } else if (next.heading === null && last) next.heading = last.heading;
      last = next;
      listeners.forEach((fn) => fn(last));
      send();
    }

    function start() {
      if (watchId !== null || !navigator.geolocation) return;
      watchId = navigator.geolocation.watchPosition(onPos, (e) => {
        if (e.code === 1) UI.toast('لازم تسمح بالوصول لموقعك حتى تستقبل رحلات', 'error');
      }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
      // نبضة كل 15 ثانية حتى لو واقف — وإلا النظام يعتبر موقعك قديماً
      heartbeat = setInterval(() => send(true), 15000);
    }
    function stop() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat); watchId = null; heartbeat = null;
    }
    const get = () => last;
    const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    return { start, stop, get, on, sendNow: () => send(true) };
  })();

  function distance(a, b) {
    const r = Math.PI / 180, R = 6371000;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ------------------------ إبقاء الشاشة مضاءة أثناء العمل ------------------------ */
  const Awake = (() => {
    let lock = null, wanted = false;
    async function acquire() {
      if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try { lock = await navigator.wakeLock.request('screen'); } catch { /* غير مدعوم */ }
    }
    document.addEventListener('visibilitychange', acquire);
    return {
      on() { wanted = true; acquire(); },
      off() { wanted = false; if (lock) { lock.release().catch(() => {}); lock = null; } },
    };
  })();

  /* ------------------------------ صوت واهتزاز الطلب ------------------------------ */
  const Chime = (() => {
    let ctx = null;
    function unlock() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch {}
    }
    function play() {
      try {
        if (!ctx) return;
        const t0 = ctx.currentTime;
        [0, .18, .36, .9, 1.08, 1.26].forEach((d, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = i % 3 === 2 ? 1175 : 880;
          g.gain.setValueAtTime(0, t0 + d);
          g.gain.linearRampToValueAtTime(.35, t0 + d + .02);
          g.gain.exponentialRampToValueAtTime(.001, t0 + d + .16);
          o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + .18);
        });
      } catch {}
      if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 500]);
    }
    return { unlock, play };
  })();

  /* ------------------------------ اسحب للتأكيد ------------------------------ */
  /** زر سحب — يمنع الضغط بالغلط أثناء القيادة. يعمل أيضاً بالكيبورد (Enter). */
  function swipe(label, onConfirm, { tone = 'brand' } = {}) {
    const node = el(`
      <div class="swipe ${tone === 'green' ? 'swipe--green' : ''}">
        <span class="swipe__label">${esc(label)}</span>
        <button type="button" class="swipe__thumb" aria-label="${esc(label)}">${Icon('back', 24)}</button>
      </div>`);
    const thumb = node.querySelector('.swipe__thumb');
    let startX = 0, dx = 0, dragging = false, busy = false;
    const rtl = () => getComputedStyle(node).direction === 'rtl';
    const max = () => node.clientWidth - thumb.offsetWidth - 10;

    const setX = (v) => { thumb.style.transform = `translateX(${rtl() ? -v : v}px)`; };
    const reset = () => { thumb.style.transition = 'transform .25s'; setX(0); setTimeout(() => (thumb.style.transition = ''), 260); };

    async function fire() {
      if (busy) return;
      busy = true; node.classList.add('is-done'); setX(max());
      try { await onConfirm(); }
      finally { busy = false; node.classList.remove('is-done'); reset(); }
    }

    thumb.addEventListener('pointerdown', (e) => {
      if (busy) return;
      dragging = true; startX = e.clientX; dx = 0; thumb.setPointerCapture(e.pointerId);
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const raw = (e.clientX - startX) * (rtl() ? -1 : 1);
      dx = Math.max(0, Math.min(max(), raw));
      setX(dx);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (dx > max() * 0.82) fire(); else reset();
    };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    thumb.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    return node;
  }

  /* ------------------------------ فتح الملاحة ------------------------------ */
  const NAV_KEY = 'nashmi.cap.nav';
  const navPref = () => { try { return localStorage.getItem(NAV_KEY) || ''; } catch { return ''; } };
  const setNavPref = (v) => { try { localStorage.setItem(NAV_KEY, v); } catch {} };

  function navUrl(app, p) {
    if (app === 'waze') return `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`;
    return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
  }

  /** يفتح الملاحة بالتطبيق المفضّل، أو يسأل أول مرة */
  function navigate(p) {
    const pref = navPref();
    if (pref) { window.open(navUrl(pref, p), '_blank'); return; }
    const s = UI.sheet(`
      <h2 class="h2" style="margin-bottom:var(--s-2)">افتح الملاحة بـ</h2>
      <p class="muted sm" style="margin:0 0 var(--s-4)">بنتذكر اختيارك، وبتقدر تغيّره من حسابك.</p>
      <button class="btn btn--primary" data-app="google">Google Maps</button>
      <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-app="waze">Waze</button>`);
    s.node.querySelectorAll('[data-app]').forEach((b) => {
      b.onclick = () => { setNavPref(b.dataset.app); s.close(); window.open(navUrl(b.dataset.app, p), '_blank'); };
    });
  }

  /* ------------------------------ صيغ ------------------------------ */
  const fils = (text) => Math.round(Number(String(text).replace(/[^\d.]/g, '')) * 1000);
  const mmss = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const jod = (f) => {
    const v = Math.abs(Math.round(f));
    return `${f < 0 ? '-' : ''}${Math.floor(v / 1000)}.${String(v % 1000).padStart(3, '0')}`;
  };

  return { Location, Awake, Chime, swipe, navigate, navPref, setNavPref, distance, mmss, jod, fils };
})();
