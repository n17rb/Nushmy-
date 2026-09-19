/* الحساب: الملف الشخصي، الأماكن، الرحلات، المظهر، الإعدادات */
window.Screens = window.Screens || {};

(function () {
  const { el, esc, show, toast, busy } = UI;

  /* ------------------------------ القائمة ------------------------------ */
  Screens.account = function accountScreen() {
    const u = App.user || {};
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">حسابي</div>
          <span style="width:44px"></span>
        </div>

        <div class="pad-x">
          <button class="card row" data-profile style="width:100%;text-align:start;gap:var(--s-4)">
            ${UI.avatar(u, 'avatar--md')}
            <span class="grow" style="min-width:0">
              <span class="bold" style="display:block;font-size:17px">${esc(u.name || 'أكمل بياناتك')}</span>
              <span class="sm muted-3 num" style="display:block;direction:ltr;text-align:start">${esc(u.phone || '')}</span>
            </span>
            <span class="muted-3">${Icon('forward', 18)}</span>
          </button>

          <div class="list" style="margin-top:var(--s-5)">
            <button class="list-item" data-trips>
              <span class="list-item__icon">${Icon('receipt', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">رحلاتي</span>
              <span class="list-item__sub">السجل والفواتير</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span>
            </button>
            <button class="list-item" data-places>
              <span class="list-item__icon">${Icon('pin', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">أماكني</span>
              <span class="list-item__sub">البيت، الشغل وغيرها</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span>
            </button>
            <button class="list-item" data-appearance>
              <span class="list-item__icon">${Icon('moon', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">المظهر</span>
              <span class="list-item__sub" data-theme-label></span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span>
            </button>
            <button class="list-item" data-safety>
              <span class="list-item__icon">${Icon('shield', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">الأمان</span>
              <span class="list-item__sub">مشاركة الرحلة وجهات الطوارئ</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span>
            </button>
            <button class="list-item" data-help>
              <span class="list-item__icon">${Icon('help', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">المساعدة والدعم</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span>
            </button>
          </div>

          <button class="btn btn--ghost" style="margin:var(--s-6) 0" data-logout>
            ${Icon('logout', 18)} تسجيل الخروج
          </button>
          <p class="xs muted-3" style="text-align:center;padding-bottom:calc(var(--s-6) + var(--safe-b))">
            نشمي · النسخة 0.1 · الكرك
          </p>
        </div>
      </section>`);

    const labels = { system: 'حسب النظام', light: 'فاتح', dark: 'داكن' };
    node.querySelector('[data-theme-label]').textContent = labels[UI.getTheme()] || 'حسب النظام';

    node.querySelector('[data-back]').onclick = () => App.go('home');
    node.querySelector('[data-profile]').onclick = () => show(Screens.profile());
    node.querySelector('[data-trips]').onclick = () => show(Screens.trips());
    node.querySelector('[data-places]').onclick = () => show(Screens.places());
    node.querySelector('[data-appearance]').onclick = () => show(Screens.appearance());
    node.querySelector('[data-safety]').onclick = () => show(Screens.safety());
    node.querySelector('[data-help]').onclick = () => show(Screens.help());

    node.querySelector('[data-logout]').onclick = async () => {
      const yes = await UI.confirm({ title: 'تسجيل الخروج؟', body: 'راح تحتاج ترسل رمز جديد لما ترجع', confirmText: 'خروج', danger: true });
      if (!yes) return;
      await App.logout();
    };

    return node;
  };

  /* --------------------------- الملف الشخصي --------------------------- */
  Screens.profile = function profileScreen() {
    const u = App.user || {};
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">بياناتي</div>
          <span style="width:44px"></span>
        </div>

        <div class="pad-x">
          <div class="avatar-edit" style="margin-block:var(--s-4) var(--s-7)">
            <div class="avatar avatar--lg" data-avatar>${u.photoUrl ? `<img src="${esc(u.photoUrl)}" alt="">` : (u.name ? esc(UI.initials(u.name)) : Icon('user', 38))}</div>
            <button class="avatar-edit__btn" data-pick aria-label="تغيير الصورة">${Icon('camera', 18)}</button>
            <input type="file" accept="image/*" class="hidden" data-file>
          </div>
          ${u.photoUrl ? '<button class="btn btn--sm btn--ghost" style="margin:0 auto var(--s-6);display:flex" data-remove>حذف الصورة</button>' : ''}

          <label class="field">
            <span class="field__label">الاسم</span>
            <input class="input" data-name value="${esc(u.name || '')}" maxlength="60" placeholder="اسمك الكامل">
          </label>

          <label class="field">
            <span class="field__label">رقم الهاتف</span>
            <input class="input num" value="${esc(u.phone || '')}" disabled style="direction:ltr;text-align:start;opacity:.65">
          </label>
          <p class="sm muted-3" style="margin:-8px 0 var(--s-5)">رقم الهاتف هو هويتك في نشمي ولا يمكن تغييره من هنا.</p>

          <label class="field">
            <span class="field__label">البريد الإلكتروني <span class="muted-3">(اختياري)</span></span>
            <input class="input" type="email" data-email value="${esc(u.email || '')}" placeholder="name@example.com" style="direction:ltr;text-align:start">
          </label>

          <p class="field__error hidden" data-err></p>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-save>حفظ التغييرات</button>
        </div>
      </section>`);

    const err = node.querySelector('[data-err]');
    const file = node.querySelector('[data-file]');
    node.querySelector('[data-back]').onclick = () => show(Screens.account());
    node.querySelector('[data-pick]').onclick = () => file.click();

    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) return toast('الصورة كبيرة جداً', 'error');
      try {
        const dataUrl = await UI.resizeImage(f);
        node.querySelector('[data-avatar]').innerHTML = `<img src="${dataUrl}" alt="">`;
        const res = await API.uploadPhoto(dataUrl);
        App.setUser(res.user);
        toast('تم تحديث الصورة', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };

    const removeBtn = node.querySelector('[data-remove]');
    if (removeBtn) removeBtn.onclick = async () => {
      const yes = await UI.confirm({ title: 'حذف الصورة؟', confirmText: 'حذف', danger: true });
      if (!yes) return;
      try {
        const res = await API.removePhoto();
        App.setUser(res.user);
        show(Screens.profile());
        toast('تم حذف الصورة', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };

    node.querySelector('[data-save]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      busy(btn, true, 'جاري الحفظ');
      err.classList.add('hidden');
      try {
        const res = await API.updateMe({
          name: node.querySelector('[data-name]').value.trim(),
          email: node.querySelector('[data-email]').value.trim() || null,
        });
        App.setUser(res.user);
        toast('تم حفظ بياناتك', 'success');
        show(Screens.account());
      } catch (e) {
        err.textContent = e.message; err.classList.remove('hidden');
        busy(btn, false);
      }
    };

    return node;
  };

  /* ------------------------------ المظهر ------------------------------ */
  Screens.appearance = function appearanceScreen() {
    const cur = UI.getTheme();
    const opts = [
      { v: 'system', t: 'حسب النظام', s: 'يتبع إعدادات هاتفك', i: 'settings' },
      { v: 'light',  t: 'فاتح',       s: 'خلفية بيضاء دائماً',  i: 'sun' },
      { v: 'dark',   t: 'داكن',       s: 'مريح للعين ليلاً',    i: 'moon' },
    ];
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">المظهر</div>
          <span style="width:44px"></span>
        </div>
        <div class="pad-x">
          <div class="list">
            ${opts.map((o) => `
              <button class="list-item" data-v="${o.v}">
                <span class="list-item__icon ${o.v === cur ? 'list-item__icon--brand' : ''}">${Icon(o.i, 20)}</span>
                <span class="list-item__body">
                  <span class="list-item__title">${o.t}</span>
                  <span class="list-item__sub">${o.s}</span>
                </span>
                <span class="list-item__end" style="color:var(--brand-600)">${o.v === cur ? Icon('checkCircle', 22) : ''}</span>
              </button>`).join('')}
          </div>
          <p class="sm muted-3" style="margin-top:var(--s-5)">
            الوضع الليلي يغيّر ألوان التطبيق والخريطة معاً.
          </p>
        </div>
      </section>`);

    node.querySelector('[data-back]').onclick = () => show(Screens.account());
    node.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = async () => {
        UI.setTheme(b.dataset.v);
        show(Screens.appearance());
        try { await API.updateMe({ theme: b.dataset.v }); } catch {}
      };
    });
    return node;
  };

  /* ------------------------------ رحلاتي ------------------------------ */
  Screens.trips = function tripsScreen() {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">رحلاتي</div>
          <span style="width:44px"></span>
        </div>
        <div class="pad-x" data-list>
          <div class="skeleton" style="height:76px;margin-bottom:var(--s-3)"></div>
          <div class="skeleton" style="height:76px"></div>
        </div>
      </section>`);

    node.querySelector('[data-back]').onclick = () => show(Screens.account());

    (async () => {
      const box = node.querySelector('[data-list]');
      try {
        const { trips } = await API.tripHistory();
        if (!trips.length) {
          box.innerHTML = `<div class="empty"><div class="empty__icon">${Icon('empty', 64)}</div>
            <p class="bold">ما عندك رحلات بعد</p>
            <p class="sm">أول رحلة لك رح تظهر هنا</p></div>`;
          return;
        }
        box.innerHTML = `<div class="list">${trips.map((t) => `
          <div class="list-item" style="align-items:flex-start">
            <span class="list-item__icon ${t.status === 'TRIP_COMPLETED' ? 'list-item__icon--brand' : ''}">
              ${Icon(t.status === 'TRIP_COMPLETED' ? 'car' : 'close', 20)}
            </span>
            <span class="list-item__body">
              <span class="list-item__title">${esc(t.destAddress || 'وجهة')}</span>
              <span class="list-item__sub">${esc(UI.dateText(t.requestedAt))} · ${esc(t.statusLabel)}</span>
            </span>
            <span class="list-item__end" style="text-align:end">
              <span class="bold num" style="color:var(--text)">${esc(t.fareText)}</span>
              <span class="xs muted-3" style="display:block">د.أ</span>
            </span>
          </div>`).join('')}</div>`;
      } catch (e) {
        box.innerHTML = `<p class="sm muted-3">${esc(e.message)}</p>`;
      }
    })();

    return node;
  };

  /* ------------------------------ أماكني ------------------------------ */
  Screens.places = function placesScreen() {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">أماكني</div>
          <span style="width:44px"></span>
        </div>
        <div class="pad-x" data-list>
          <div class="skeleton" style="height:64px;margin-bottom:var(--s-3)"></div>
        </div>
      </section>`);

    node.querySelector('[data-back]').onclick = () => show(Screens.account());

    const load = async () => {
      const box = node.querySelector('[data-list]');
      try {
        const { saved } = await API.places();
        const rows = [];
        for (const kind of ['home', 'work']) {
          const p = saved.find((s) => s.kind === kind);
          rows.push(row(kind, kind === 'home' ? 'البيت' : 'الشغل', p));
        }
        for (const p of saved.filter((s) => s.kind === 'custom')) rows.push(row('custom', p.label, p));
        box.innerHTML = `<div class="list">${rows.join('')}</div>
          <button class="btn btn--ghost" style="margin-top:var(--s-5)" data-add-custom>${Icon('plus', 18)} أضف مكاناً جديداً</button>`;

        box.querySelectorAll('[data-set]').forEach((b) => {
          b.onclick = () => show(Screens.destination({ mode: 'save', kind: b.dataset.set }));
        });
        box.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async (e) => {
            e.stopPropagation();
            const yes = await UI.confirm({ title: 'حذف المكان؟', confirmText: 'حذف', danger: true });
            if (!yes) return;
            try { await API.deletePlace(b.dataset.del); toast('تم الحذف', 'success'); load(); }
            catch (err) { toast(err.message, 'error'); }
          };
        });
        const addCustom = box.querySelector('[data-add-custom]');
        if (addCustom) addCustom.onclick = () => show(Screens.destination({ mode: 'save', kind: 'custom' }));
      } catch (e) {
        box.innerHTML = `<p class="sm muted-3">${esc(e.message)}</p>`;
      }
    };
    load();

    function row(kind, label, p) {
      const icon = kind === 'home' ? 'home' : kind === 'work' ? 'work' : 'pin';
      return `<div class="list-item">
        <span class="list-item__icon ${p ? 'list-item__icon--brand' : ''}">${Icon(icon, 20)}</span>
        <span class="list-item__body">
          <span class="list-item__title">${esc(label)}</span>
          <span class="list-item__sub">${p ? esc(p.address || 'محفوظ') : 'غير محدد'}</span>
        </span>
        ${p
          ? `<button class="icon-btn" style="width:38px;height:38px;box-shadow:none;border:0;background:none;color:var(--danger-500)" data-del="${esc(p.id)}" aria-label="حذف">${Icon('trash', 18)}</button>`
          : `<button class="btn btn--sm btn--ghost" data-set="${kind}">أضف</button>`}
      </div>`;
    }

    return node;
  };

  /* ------------------------------- الأمان ------------------------------- */
  Screens.safety = function safetyScreen() {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">الأمان</div>
          <span style="width:44px"></span>
        </div>
        <div class="pad-x">
          <div class="card" style="margin-bottom:var(--s-4)">
            <div class="row" style="align-items:flex-start;gap:var(--s-3)">
              <span style="color:var(--brand-600)">${Icon('shield', 22)}</span>
              <div>
                <div class="bold">مشاركة الرحلة</div>
                <p class="sm muted" style="margin:6px 0 0">
                  أثناء أي رحلة تقدر تشارك تفاصيل الكابتن ورقم اللوحة مع أي شخص من زر
                  «شارك الرحلة» في شاشة الرحلة.
                </p>
              </div>
            </div>
          </div>
          <div class="card" style="background:var(--warning-100);border-color:transparent">
            <div class="row" style="align-items:flex-start;gap:var(--s-3);color:var(--warning-500)">
              ${Icon('alert', 22)}
              <p class="sm bold" style="margin:0;color:var(--text)">
                نشمي ليس بديلاً عن خدمات الطوارئ الرسمية. في أي حالة طارئة اتصل مباشرة بالجهات المختصة.
              </p>
            </div>
          </div>
        </div>
      </section>`);
    node.querySelector('[data-back]').onclick = () => show(Screens.account());
    return node;
  };

  /* ------------------------------ المساعدة ------------------------------ */
  Screens.help = function helpScreen() {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">المساعدة</div>
          <span style="width:44px"></span>
        </div>
        <div class="pad-x">
          <div class="list">
            <div class="list-item"><span class="list-item__icon">${Icon('car', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">كيف أطلب سيارة؟</span>
              <span class="list-item__sub">اضغط «إلى أين؟» واختر وجهتك ثم أكّد الطلب</span></span></div>
            <div class="list-item"><span class="list-item__icon">${Icon('wallet', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">كيف أدفع؟</span>
              <span class="list-item__sub">الدفع حالياً نقداً للكابتن في نهاية الرحلة</span></span></div>
            <div class="list-item"><span class="list-item__icon">${Icon('close', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">الإلغاء والرسوم</span>
              <span class="list-item__sub">الإلغاء قبل قبول الكابتن مجاني دائماً</span></span></div>
          </div>
        </div>
      </section>`);
    node.querySelector('[data-back]').onclick = () => show(Screens.account());
    return node;
  };
})();
