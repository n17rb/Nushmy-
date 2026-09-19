/* منسّق التطبيق: الإقلاع، حالة المستخدم، التنقل بين الشاشات */
window.App = (function () {
  const state = {
    user: null,
    pickup: null,
    destination: null,
    map: null,
    config: null,
  };

  function setUser(u) { state.user = u; }

  async function go(route) {
    if (route === 'home') {
      // إن كانت هناك رحلة نشطة نعود إليها مباشرة بدل الرئيسية
      try {
        const { trip } = await API.activeTrip();
        if (trip) return UI.show(Screens.tripLive(trip));
      } catch {}
      return UI.show(Screens.home());
    }
    if (route === 'welcome') return UI.show(Screens.welcome());
    if (route === 'phone') return UI.show(Screens.phone());
    return UI.show(Screens.home());
  }

  async function logout() {
    try { await API.logout(); } catch {}
    API.setToken(null);
    state.user = null;
    state.pickup = null;
    state.destination = null;
    UI.show(Screens.welcome());
  }

  function watchConnection() {
    const bar = document.createElement('div');
    bar.className = 'offline-bar hidden';
    bar.textContent = 'لا يوجد اتصال بالإنترنت — بننتظر رجوع الشبكة';
    document.getElementById('app').appendChild(bar);
    const sync = () => bar.classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', () => { sync(); UI.toast('رجع الاتصال', 'success'); });
    window.addEventListener('offline', sync);
    sync();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* التطبيق يعمل بدونه */ });
  }

  const bootStartedAt = performance.now();

  async function boot() {
    UI.applyTheme(UI.getTheme());
    registerServiceWorker();

    try {
      state.config = await API.config();
      MapKit.configure(state.config.maps || {});
    } catch { /* الإعدادات اختيارية للإقلاع */ }

    watchConnection();
    if (!window.L) UI.toast('تعذّر تحميل الخرائط. تحقق من الإنترنت ثم أعد فتح التطبيق', 'error');

    let authed = false;
    try {
      authed = await API.tryRefresh();
      if (authed) {
        const { user } = await API.me();
        setUser(user);
        if (user.theme && user.theme !== UI.getTheme()) UI.setTheme(user.theme);
      }
    } catch { authed = false; }

    // شاشة البداية تبقى حتى تكتمل حركتها (~1.2 ثانية) ثم تختفي بنعومة
    const splash = document.getElementById('splash');
    const MIN_SPLASH_MS = 1250;
    const reveal = async () => {
      const waited = performance.now() - bootStartedAt;
      if (waited < MIN_SPLASH_MS) await new Promise((r) => setTimeout(r, MIN_SPLASH_MS - waited));
      splash.classList.add('splash--out');
      setTimeout(() => splash.remove(), 420);
    };

    if (!authed) { await go('welcome'); reveal(); return; }
    if (!state.user.profileComplete) { UI.show(Screens.completeProfile()); reveal(); return; }
    await go('home');
    reveal();
  }

  window.addEventListener('DOMContentLoaded', () => {
    // ننتظر تحميل Leaflet قبل أول شاشة فيها خريطة
    const start = () => boot().catch((e) => {
      document.getElementById('splash').innerHTML =
        `<div class="pad" style="text-align:center"><p class="bold">تعذّر تشغيل التطبيق</p>
         <p class="sm muted">${UI.esc(e.message)}</p></div>`;
    });
    if (window.L) start();
    else window.addEventListener('load', start, { once: true });
  });

  return {
    get user() { return state.user; },
    get config() { return state.config; },
    get pickup() { return state.pickup; },
    set pickup(v) { state.pickup = v; },
    get destination() { return state.destination; },
    set destination(v) { state.destination = v; },
    get map() { return state.map; },
    set map(v) { state.map = v; },
    setUser, go, logout,
  };
})();
