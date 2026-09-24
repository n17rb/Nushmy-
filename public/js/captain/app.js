/* ==========================================================
   منسّق تطبيق الكابتن — نفس واجهة App التي تستخدمها شاشات الدخول المشتركة
   (Screens.phone / Screens.otp / Screens.completeProfile).
   ========================================================== */
window.App = (function () {
  const state = { user: null, cap: null, online: false, config: null };

  const setUser = (u) => { state.user = u; };

  async function refreshMe() {
    const me = await API.cap.me();
    state.user = me.user;
    state.cap = me;
    if (me.captain) state.online = me.captain.isOnline;
    return me;
  }

  function setOnline(v) {
    state.online = v;
    if (state.cap && state.cap.captain) state.cap.captain.isOnline = v;
    if (v) { CapKit.Location.start(); CapKit.Awake.on(); }
    else { CapKit.Location.stop(); CapKit.Awake.off(); }
  }

  /** روابط الإشعارات: #notifications · #support/<id> · #chat */
  function openLink(url) {
    const hash = String(url || '').split('#')[1] || '';
    if (!hash || !state.cap || !state.cap.captain) return false;
    history.replaceState(null, '', location.pathname);
    const home = () => go('home');
    if (hash === 'notifications') { UI.show(Inbox.notifications({ as: 'captain', back: home })); return true; }
    if (hash.startsWith('support/')) { UI.show(Inbox.supportThread({ id: hash.slice(8), as: 'captain', back: home })); return true; }
    return false;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open') openLink(e.data.url); });
  }

  /** يقرر الشاشة الصحيحة حسب حالة الكابتن */
  let pushChecked = false;
  async function go(route) {
    if (route === 'welcome') return UI.show(CapScreens.welcome());
    if (route === 'phone') return UI.show(Screens.phone());
    let me;
    try { me = await refreshMe(); }
    catch (e) {
      if (e.status === 401) return UI.show(CapScreens.welcome());
      UI.toast(e.message, 'error');
      return;
    }
    if (!me.captain) return UI.show(CapScreens.register());
    if (!pushChecked) { pushChecked = true; PushKit.refresh(); }
    if (me.captain.status !== 'APPROVED') return UI.show(CapScreens.pending(me));
    try {
      const { trip } = await API.cap.activeTrip();
      if (trip) return UI.show(CapScreens.trip(trip));
    } catch {}
    if (state.online) setOnline(true);
    return UI.show(CapScreens.home());
  }

  async function logout() {
    try { if (state.online) await API.cap.online(false); } catch {}
    setOnline(false);
    try { await API.logout(); } catch {}
    API.setToken(null);
    state.user = null; state.cap = null;
    UI.show(CapScreens.welcome());
  }

  function watchConnection() {
    const bar = document.createElement('div');
    bar.className = 'offline-bar hidden';
    bar.textContent = 'لا يوجد اتصال بالإنترنت — الطلبات ما رح توصلك لحد ما يرجع';
    document.getElementById('app').appendChild(bar);
    const sync = () => bar.classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', () => { sync(); UI.toast('رجع الاتصال', 'success'); CapKit.Location.sendNow(); });
    window.addEventListener('offline', sync);
    sync();
  }

  const bootStartedAt = performance.now();

  async function boot() {
    // بيفتح فاتح دايماً، والكابتن بيحوّله للداكن من حسابه إذا بده
    UI.applyTheme(UI.getTheme());

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    try { state.config = await API.config(); MapKit.configure(state.config.maps || {}); } catch {}
    watchConnection();
    if (!window.L) UI.toast('تعذّر تحميل الخرائط. تحقق من الإنترنت ثم أعد فتح التطبيق', 'error');
    // أول لمسة بالتطبيق تفعّل صوت الطلبات (المتصفحات تمنع الصوت قبل تفاعل المستخدم)
    document.addEventListener('pointerdown', () => CapKit.Chime.unlock(), { once: true });

    let authed = false;
    try { authed = await API.tryRefresh(); } catch {}

    const splash = document.getElementById('splash');
    const reveal = async () => {
      const waited = performance.now() - bootStartedAt;
      if (waited < 1250) await new Promise((r) => setTimeout(r, 1250 - waited));
      splash.classList.add('splash--out');
      setTimeout(() => splash.remove(), 420);
    };

    if (!authed) { UI.show(CapScreens.welcome()); reveal(); return; }
    const link = location.href;
    await go('home');
    openLink(link);
    reveal();
  }

  window.addEventListener('DOMContentLoaded', () => {
    const start = () => boot().catch((e) => {
      document.getElementById('splash').innerHTML =
        `<div class="pad" style="text-align:center"><p class="bold">تعذّر تشغيل التطبيق</p><p class="sm muted">${UI.esc(e.message)}</p></div>`;
    });
    if (window.L) start(); else window.addEventListener('load', start, { once: true });
  });

  return {
    get user() { return state.user; },
    get cap() { return state.cap; },
    get online() { return state.online; },
    get config() { return state.config; },
    // حقول تستخدمها الشاشات المشتركة
    pickup: null, destination: null, map: null,
    skipProfileStep: true,   // الاسم بينطلب بشاشة تسجيل السيارة
    setUser, setOnline, refreshMe, go, logout,
  };
})();
