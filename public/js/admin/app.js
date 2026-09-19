/* ==========================================================
   لوحة الإدارة — الهيكل: الدخول، الصلاحيات، القائمة الجانبية، التنقل، أدوات مشتركة.
   ========================================================== */
window.Admin = (function () {
  const { el, esc, toast } = UI;
  const state = { me: null, counts: { captains: 0, deposits: 0 }, timers: [], cleanups: [] };
  const Pages = {};

  /* ------------------------------ الصلاحيات ------------------------------ */
  const can = (perm) => {
    const p = (state.me && state.me.perms) || [];
    return p.includes('*') || p.includes(perm);
  };

  /* ------------------------------ أدوات عرض ------------------------------ */
  const jod = (fils) => {
    const f = Math.round(Number(fils) || 0), v = Math.abs(f);
    return `${f < 0 ? '-' : ''}${Math.floor(v / 1000)}.${String(v % 1000).padStart(3, '0')}`;
  };
  const toFils = (jodText) => Math.round(Number(String(jodText).replace(/[^\d.-]/g, '')) * 1000);
  const when = (iso) => (iso ? UI.dateText(iso) : '—');

  const PILL = {
    // الرحلات
    TRIP_COMPLETED: 'ok', CANCELLED_BY_CUSTOMER: 'bad', CANCELLED_BY_DRIVER: 'bad', CANCELLED_BY_SYSTEM: 'bad', NO_DRIVER_FOUND: 'warn',
    REQUESTED: 'live', SEARCHING: 'live', DRIVER_ASSIGNED: 'live', DRIVER_ACCEPTED: 'live', DRIVER_ARRIVING: 'live', DRIVER_ARRIVED: 'live', TRIP_STARTED: 'live',
    // الحسابات
    APPROVED: 'ok', ACTIVE: 'ok', PENDING: 'warn', PENDING_REVIEW: 'warn', REJECTED: 'bad', SUSPENDED: 'bad', BLOCKED: 'bad',
  };
  const LABEL = {
    APPROVED: 'معتمد', PENDING: 'قيد المراجعة', REJECTED: 'مرفوض', SUSPENDED: 'موقوف', BLOCKED: 'محظور', ACTIVE: 'فعّال',
    PENDING_REVIEW: 'قيد المراجعة',
  };
  const pill = (status, label) => `<span class="pill ${PILL[status] ? 'pill--' + PILL[status] : ''}">${esc(label || LABEL[status] || status)}</span>`;
  const person = (name, phone, photoUrl) => `
    <span class="person">${UI.avatar({ name, photoUrl })}
      <span style="min-width:0"><b>${esc(name || 'بدون اسم')}</b>${phone ? `<span>${esc(phone)}</span>` : ''}</span></span>`;

  /** نافذة تطلب سبباً قبل أي إجراء حساس */
  function ask({ title, body = '', label = 'السبب', required = true, confirmText = 'تأكيد', danger = false, extra = '' }) {
    return new Promise((resolve) => {
      const wrap = el(`
        <div class="modal-host"><div class="modal">
          <h2 class="h2" style="margin-bottom:6px">${esc(title)}</h2>
          ${body ? `<p class="muted sm" style="margin:0 0 14px">${esc(body)}</p>` : ''}
          ${extra}
          <div class="field-row" style="margin-bottom:14px">
            <label for="ask-reason">${esc(label)}${required ? '' : ' (اختياري)'}</label>
            <textarea class="in" id="ask-reason" rows="3" style="padding:10px;min-height:80px"></textarea>
          </div>
          <div class="actions">
            <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(confirmText)}</button>
            <button class="btn btn--ghost" data-no>تراجع</button>
          </div>
        </div></div>`);
      const input = wrap.querySelector('#ask-reason');
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-no]').onclick = () => done(null);
      wrap.onclick = (e) => { if (e.target === wrap) done(null); };
      wrap.querySelector('[data-yes]').onclick = () => {
        const reason = input.value.trim();
        if (required && reason.length < 3) { input.focus(); toast('اكتب السبب (3 أحرف على الأقل)', 'error'); return; }
        const out = { reason };
        wrap.querySelectorAll('[data-field]').forEach((f) => { out[f.dataset.field] = f.value; });
        done(out);
      };
      document.getElementById('modal').appendChild(wrap);
      setTimeout(() => input.focus(), 30);
    });
  }

  /** تحميل صورة خاصة (وثيقة/إشعار) بصلاحية الإدارة */
  async function privateImage(imgHost, fileId) {
    if (!fileId) { imgHost.textContent = 'لا يوجد ملف'; return; }
    const load = () => fetch('/api/admin/files/' + fileId, { headers: { Authorization: 'Bearer ' + API.getToken() } });
    try {
      let r = await load();
      if (r.status === 401 && await API.tryRefresh()) r = await load();
      if (!r.ok) { imgHost.textContent = r.status === 404 ? 'الملف غير متوفر' : 'تعذّر التحميل'; return; }
      const url = URL.createObjectURL(await r.blob());
      imgHost.innerHTML = `<img src="${url}" alt="">`;
      imgHost.onclick = () => {
        const lb = el(`<div class="lightbox" role="dialog" aria-label="عرض الصورة"><img src="${url}" alt=""></div>`);
        lb.onclick = () => lb.remove();
        document.body.appendChild(lb);
      };
    } catch { imgHost.textContent = 'تعذّر التحميل'; }
  }

  /** مؤقت يتوقف تلقائياً عند مغادرة الصفحة */
  function every(ms, fn) { const t = setInterval(fn, ms); state.timers.push(t); return t; }
  function onLeave(fn) { state.cleanups.push(fn); }

  /* ------------------------------ الدخول ------------------------------ */
  function loginScreen(message) {
    const app = document.getElementById('app');
    app.innerHTML = '';
    const node = el(`
      <div class="login"><div class="login__card">
        <img class="brand__mark" src="/img/logo-mark.png" alt="">
        <div><h1 class="h1">لوحة إدارة نشمي</h1>
          <p class="muted sm" style="margin:4px 0 0">${esc(message || 'ادخل برقم المشرف')}</p></div>
        <div data-step="phone" style="display:grid;gap:10px">
          <label class="field-row"><span style="font-size:12.5px;font-weight:700;color:var(--text-3)">رقم الهاتف</span>
            <input class="in" id="lg-phone" inputmode="tel" placeholder="07XXXXXXXX" style="direction:ltr;text-align:start;min-height:48px;font-size:17px"></label>
          <button class="btn btn--primary btn--block" data-send>أرسل الرمز</button>
        </div>
        <div data-step="code" class="hidden" style="display:grid;gap:10px">
          <label class="field-row"><span style="font-size:12.5px;font-weight:700;color:var(--text-3)">رمز التحقق</span>
            <input class="in" id="lg-code" inputmode="numeric" maxlength="4" style="direction:ltr;text-align:center;min-height:48px;font-size:22px;letter-spacing:.3em"></label>
          <p class="sm" data-dev style="margin:0"></p>
          <button class="btn btn--primary btn--block" data-verify>دخول</button>
        </div>
        <p class="field__error hidden" data-err></p>
      </div></div>`);
    app.appendChild(node);
    const err = node.querySelector('[data-err]');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    let phone = '';
    node.querySelector('[data-send]').onclick = async (e) => {
      err.classList.add('hidden');
      phone = node.querySelector('#lg-phone').value.trim();
      UI.busy(e.currentTarget, true);
      try {
        const r = await API.requestOtp(phone);
        node.querySelector('[data-step="phone"]').classList.add('hidden');
        node.querySelector('[data-step="code"]').classList.remove('hidden');
        const dev = node.querySelector('[data-dev]');
        if (r.devCode) dev.innerHTML = `وضع التطوير — الرمز: <b class="num">${esc(r.devCode)}</b>${r.notice ? `<br><span class="muted xs">${esc(r.notice)}</span>` : ''}`;
        else if (r.channel === 'whatsapp') dev.textContent = 'وصلك الرمز على واتساب';
        node.querySelector('#lg-code').focus();
      } catch (x) { fail(x.message); } finally { UI.busy(e.currentTarget, false); }
    };
    node.querySelector('[data-verify]').onclick = async (e) => {
      err.classList.add('hidden');
      UI.busy(e.currentTarget, true);
      try {
        const r = await API.verifyOtp(phone, node.querySelector('#lg-code').value.trim());
        API.setToken(r.accessToken);
        await start();
      } catch (x) { fail(x.message); UI.busy(e.currentTarget, false); }
    };
    node.querySelector('#lg-phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') node.querySelector('[data-send]').click(); });
    node.querySelector('#lg-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') node.querySelector('[data-verify]').click(); });
  }

  function notAdminScreen(user) {
    const app = document.getElementById('app');
    app.innerHTML = '';
    const node = el(`
      <div class="login"><div class="login__card">
        <img class="brand__mark" src="/img/logo-mark.png" alt="">
        <h1 class="h1">ما عندك صلاحية</h1>
        <p class="muted">الرقم <b class="num">${esc(user ? user.phone : '')}</b> مش مسجّل كمشرف.
          المالك بيضيف المشرفين من صفحة «المشرفون»، أو بيضيف رقمه بإعداد <b>ADMIN_PHONES</b> في Render.</p>
        <button class="btn btn--ghost btn--block" data-out>الدخول برقم ثاني</button>
      </div></div>`);
    app.appendChild(node);
    node.querySelector('[data-out]').onclick = async () => { try { await API.logout(); } catch {} API.setToken(null); loginScreen(); };
  }

  /* ------------------------------ الهيكل والتنقل ------------------------------ */
  const NAV = [
    { path: 'dashboard', label: 'لوحة القيادة', icon: 'chart' },
    { path: 'live', label: 'الخريطة الحية', icon: 'navigate' },
    { path: 'trips', label: 'الرحلات', icon: 'car' },
    { path: 'captains', label: 'الكباتن', icon: 'user', count: 'captains' },
    { path: 'deposits', label: 'شحن المحافظ', icon: 'wallet', count: 'deposits' },
    { path: 'customers', label: 'العملاء', icon: 'user' },
    { path: 'pricing', label: 'الأسعار', icon: 'receipt', perm: 'pricing' },
    { path: 'settings', label: 'الإعدادات', icon: 'settings', perm: 'settings' },
    { path: 'admins', label: 'المشرفون', icon: 'shield', perm: 'admins' },
    { path: 'audit', label: 'سجل العمليات', icon: 'doc' },
  ];

  function shell() {
    const app = document.getElementById('app');
    app.innerHTML = '';
    const me = state.me;
    const side = el(`
      <nav class="side" aria-label="القائمة">
        <div class="side__brand"><img src="/img/logo-mark.png" alt=""><div><b>نشمي</b><small>لوحة الإدارة</small></div></div>
        ${NAV.filter((n) => !n.perm || can(n.perm)).map((n) => `
          <a class="nav-link" href="#/${n.path}" data-nav="${n.path}">${Icon(n.icon, 19)}<span>${n.label}</span>
            ${n.count ? `<span class="count hidden" data-count="${n.count}"></span>` : ''}</a>`).join('')}
        <div class="side__foot">
          <div class="side__me">${UI.avatar(me.user)}<div style="min-width:0"><b style="display:block;font-size:14px">${esc(me.user.name || me.user.phone)}</b>
            <span class="xs muted-3">${esc(me.roleLabel)}</span></div></div>
          <div class="seg" data-theme-seg>
            <button data-v="light">فاتح</button><button data-v="dark">داكن</button><button data-v="system">تلقائي</button>
          </div>
          <button class="nav-link" data-logout style="width:100%">${Icon('logout', 19)}<span>خروج</span></button>
        </div>
      </nav>`);
    const top = el(`<div class="mobile-top"><button class="icon-btn" data-menu aria-label="القائمة">${Icon('menu', 20)}</button><b>نشمي — الإدارة</b></div>`);
    const main = el('<main class="main" id="main" tabindex="-1"></main>');
    app.append(side, top, main);

    top.querySelector('[data-menu]').onclick = () => side.classList.toggle('open');
    side.addEventListener('click', (e) => { if (e.target.closest('a')) side.classList.remove('open'); });
    side.querySelector('[data-logout]').onclick = async () => {
      if (!(await UI.confirm({ title: 'تسجيل الخروج؟', confirmText: 'خروج', danger: true }))) return;
      try { await API.logout(); } catch {} API.setToken(null); state.me = null; loginScreen();
    };
    const syncTheme = () => side.querySelectorAll('[data-theme-seg] button').forEach((b) => b.classList.toggle('on', b.dataset.v === UI.getTheme()));
    side.querySelectorAll('[data-theme-seg] button').forEach((b) => b.onclick = () => { UI.setTheme(b.dataset.v); syncTheme(); });
    syncTheme();
  }

  async function refreshCounts() {
    try {
      const d = await API.get('/api/admin/dashboard');
      state.counts = { captains: d.kpis.pendingCaptains, deposits: d.kpis.pendingDeposits };
      document.querySelectorAll('[data-count]').forEach((c) => {
        const n = state.counts[c.dataset.count] || 0;
        c.textContent = n; c.classList.toggle('hidden', !n);
      });
    } catch {}
  }

  async function route() {
    state.timers.forEach(clearInterval); state.timers = [];
    state.cleanups.forEach((f) => { try { f(); } catch {} }); state.cleanups = [];
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    const [name, id] = parts;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
    const main = document.getElementById('main');
    if (!main) return;
    const page = Pages[name] || Pages.dashboard;
    main.innerHTML = '<div class="page"><div class="skeleton" style="height:120px"></div></div>';
    main.scrollTop = 0;
    try { await page(main, id); }
    catch (e) {
      if (e.code === 'UNAUTHORIZED') return loginScreen('انتهت الجلسة، ادخل مرة ثانية');
      main.innerHTML = `<div class="page"><div class="panel"><b>تعذّر فتح الصفحة</b><p class="muted">${esc(e.message)}</p></div></div>`;
    }
  }

  async function start() {
    try {
      const me = await API.get('/api/admin/me');
      state.me = me;
    } catch (e) {
      if (e.code === 'NOT_ADMIN' || e.code === 'FORBIDDEN') {
        let user = null; try { user = (await API.me()).user; } catch {}
        return notAdminScreen(user);
      }
      return loginScreen();
    }
    shell();
    refreshCounts();
    setInterval(refreshCounts, 30000);
    route();
  }

  window.addEventListener('hashchange', () => { if (state.me) route(); });
  window.addEventListener('DOMContentLoaded', async () => {
    UI.applyTheme(UI.getTheme());
    try { const c = await API.config(); MapKit.configure(c.maps || {}); } catch {}
    const go = async () => { if (await API.tryRefresh()) start(); else loginScreen(); };
    if (document.readyState === 'complete' || window.L) go(); else window.addEventListener('load', go, { once: true });
  });

  return { Pages, can, jod, toFils, when, pill, person, ask, privateImage, every, onLeave, refreshCounts, route, get me() { return state.me; } };
})();
