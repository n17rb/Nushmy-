/* ==========================================================
   شاشات تطبيق الكابتن: الترحيب، التسجيل، المراجعة، الرئيسية (الاتصال والعروض)،
   الأرباح، المحفظة، الحساب.
   ========================================================== */
window.CapScreens = window.CapScreens || {};

(function () {
  const { el, esc, show, toast, busy } = UI;
  const S = CapScreens;

  const topbar = (title, backTo) => `
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
      <div class="topbar__title">${esc(title)}</div>
      <span style="width:44px"></span>
    </div>`;
  const wireBack = (node, fn) => { const b = node.querySelector('[data-back]'); if (b) b.onclick = fn; };

  /* --------------------------------- الترحيب --------------------------------- */
  S.welcome = function () {
    const node = el(`
      <section class="screen screen--static stage">
        <div class="stage__castle"></div>
        <div class="stage__brand">
          <img class="stage__mark" src="/img/logo-mark.png" alt="" width="124" height="124">
          <img class="stage__word" src="/img/wordmark.png" alt="نشمي">
          <span class="cap-badge">كابتن</span>
        </div>
        <div style="position:absolute;inset-inline:var(--s-5);top:47%;display:grid;gap:var(--s-3);text-align:center">
          <p class="muted" style="margin:0 0 var(--s-2)">اشتغل بوقتك، واعرف ربحك قبل ما تقبل أي رحلة.</p>
          <button class="btn btn--primary" data-start>ابدأ برقم تلفونك</button>
          <a class="sm muted-3" href="/">بدك تطلب سيارة؟ افتح تطبيق الزبون</a>
        </div>
      </section>`);
    node.querySelector('[data-start]').onclick = () => show(Screens.phone());
    return node;
  };

  /* ------------------------------ اختيار السيارة من الكتالوج ------------------------------
     الشركة ← الفئة (مش «الموديل» — الناس بتفهمها السنة) ← سنة الصنع ← اللون ← ناقل الحركة
     ومعاينة مباشرة للصورة الي رح يشوفها الزبون. */
  let catalogCache = null;
  const catalog = async () => (catalogCache = catalogCache || (await API.vehicleCatalog()));

  function vehiclePicker(initial = {}) {
    const thisYear = new Date().getFullYear();
    const v = {
      makeId: initial.makeId || null, classId: initial.classId || null,
      make: initial.makeId ? '' : (initial.make || ''), model: initial.classId ? '' : (initial.model || ''),
      year: initial.year || thisYear - 5, colorKey: initial.colorKey || null, color: initial.colorKey ? '' : (initial.color || ''),
      transmission: initial.transmission || 'automatic', other: Boolean(!initial.makeId && initial.make),
    };
    const node = el(`
      <div class="vpick">
        <div class="vpick__preview" data-preview></div>
        <div class="field"><span class="field__label">الشركة</span>
          <button type="button" class="input vpick__btn" data-make><span data-make-label>اختار الشركة</span>${Icon('forward', 16)}</button>
          <input class="input hidden" data-make-other maxlength="30" placeholder="اسم الشركة" style="margin-top:var(--s-2)"></div>
        <div class="field"><span class="field__label">الفئة <span class="muted-3">(اسم السيارة: سوناتا، كورولا، أيونك 5…)</span></span>
          <button type="button" class="input vpick__btn" data-class disabled><span data-class-label>اختار الشركة أول</span>${Icon('forward', 16)}</button>
          <input class="input hidden" data-class-other maxlength="30" placeholder="اسم الفئة" style="margin-top:var(--s-2)"></div>
        <div class="row" style="gap:var(--s-3)">
          <label class="field grow"><span class="field__label">سنة الصنع</span>
            <select class="input" data-year>${Array.from({ length: thisYear - 1995 + 2 }, (_, i) => thisYear + 1 - i)
              .map((y) => `<option ${y === Number(v.year) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
          <div class="field grow"><span class="field__label">ناقل الحركة</span>
            <div class="seg" data-trans>
              <button type="button" data-v="automatic" class="${v.transmission === 'automatic' ? 'on' : ''}">أوتوماتيك</button>
              <button type="button" data-v="manual" class="${v.transmission === 'manual' ? 'on' : ''}">عادي</button>
            </div></div>
        </div>
        <div class="field"><span class="field__label">اللون</span><div class="swatches" data-colors></div></div>
      </div>`);

    let cat = null, classImages = {};
    const mk = () => cat && cat.makes.find((m) => m.id === v.makeId);
    const cl = () => mk() && mk().classes.find((c) => c.id === v.classId);
    const col = () => cat && cat.colors.find((c) => c.id === v.colorKey);

    function preview() {
      const m = mk(), c = cl(), co = col();
      if (!cat) return;
      const label = m && c ? `${m.en} ${c.en}` : [v.make, v.model].filter(Boolean).join(' ');
      // نفس الصورة الي رح يشوفها الزبون (صورة الفئة من مكتبة الإدارة)
      const imageUrl = m && c ? classImages[m.id + '/' + c.id] || null : null;
      node.querySelector('[data-preview]').innerHTML = CarArt.card({
        imageUrl, label: label || 'سيارتك', year: Number(v.year), color: co ? co.ar : v.color, colorHex: co ? co.hex : null,
        seats: c ? c.seats : null, fuelAr: c ? cat.fuelAr[c.fuel] : null,
        transmissionAr: v.transmission === 'manual' ? 'عادي' : 'أوتوماتيك',
      });
      node.querySelector('[data-make-label]').textContent = m ? `${m.ar} · ${m.en}` : v.other ? 'شركة ثانية' : 'اختار الشركة';
      const cb = node.querySelector('[data-class]');
      cb.disabled = !m && !v.other;
      node.querySelector('[data-class-label]').textContent = c ? `${c.ar}${c.ar !== c.en ? ' · ' + c.en : ''}` : v.other ? 'اكتب الفئة تحت' : m ? 'اختار الفئة' : 'اختار الشركة أول';
      node.querySelector('[data-make-other]').classList.toggle('hidden', !v.other);
      node.querySelector('[data-class-other]').classList.toggle('hidden', !v.other);
      cb.classList.toggle('hidden', v.other);
    }

    function listSheet(title, items, onPick, { searchable = true, extra = null } = {}) {
      const sh = UI.sheet(`
        <h2 class="h2" style="margin-bottom:var(--s-3)">${esc(title)}</h2>
        ${searchable ? '<input class="input" data-q placeholder="ابحث…" style="margin-bottom:var(--s-3)">' : ''}
        <div class="vpick__list" data-list></div>
        ${extra ? `<button class="btn btn--ghost" style="margin-top:var(--s-3)" data-extra>${esc(extra)}</button>` : ''}`);
      const box = sh.node.querySelector('[data-list]');
      const draw = (q) => {
        const nq = MapKit.normalize(q || '');
        const rows = items.filter((it) => !nq || MapKit.normalize(it.ar + ' ' + it.en).includes(nq) || it.en.toLowerCase().includes((q || '').toLowerCase()));
        box.innerHTML = rows.map((it) => `<button class="list-item" data-id="${esc(it.id)}">
          <span class="list-item__body"><span class="list-item__title">${esc(it.ar)}</span>
          <span class="list-item__sub">${esc(it.sub || it.en)}</span></span></button>`).join('') || '<p class="sm muted-3 pad">ما في نتيجة</p>';
        box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { sh.close(); onPick(b.dataset.id); });
      };
      draw('');
      const q = sh.node.querySelector('[data-q]');
      if (q) q.oninput = () => draw(q.value);
      const ex = sh.node.querySelector('[data-extra]');
      if (ex) ex.onclick = () => { sh.close(); onPick(null); };
    }

    node.querySelector('[data-make]').onclick = () => listSheet('الشركة', cat.makes.map((m) => ({ id: m.id, ar: m.ar, en: m.en })), (id) => {
      if (!id) { v.other = true; v.makeId = null; v.classId = null; }
      else { if (id !== v.makeId) v.classId = null; v.makeId = id; v.other = false; }
      preview();
      if (id) node.querySelector('[data-class]').click();
    }, { extra: 'الشركة مش موجودة؟ اكتبها يدوي' });

    node.querySelector('[data-class]').onclick = () => {
      const m = mk(); if (!m) return;
      listSheet(`فئات ${m.ar}`, m.classes.map((c) => ({ id: c.id, ar: c.ar, en: c.en,
        sub: `${c.en} · ${cat.bodyAr[c.body]} · ${c.seats} مقاعد · ${cat.fuelAr[c.fuel]}` })), (id) => { v.classId = id; preview(); });
    };
    node.querySelector('[data-make-other]').oninput = (e) => { v.make = e.target.value.trim(); preview(); };
    node.querySelector('[data-class-other]').oninput = (e) => { v.model = e.target.value.trim(); preview(); };
    node.querySelector('[data-year]').onchange = (e) => { v.year = Number(e.target.value); preview(); };
    node.querySelectorAll('[data-trans] [data-v]').forEach((b) => b.onclick = () => {
      node.querySelectorAll('[data-trans] [data-v]').forEach((x) => x.classList.toggle('on', x === b)); v.transmission = b.dataset.v; preview();
    });

    (async () => {
      try { cat = await catalog(); } catch (e) { toast(e.message, 'error'); return; }
      try { classImages = (await API.classImages()).images || {}; } catch {}
      node.querySelector('[data-colors]').innerHTML = cat.colors.map((c) => `
        <button type="button" class="swatch ${c.id === v.colorKey ? 'on' : ''}" data-c="${c.id}" aria-label="${esc(c.ar)}">
          <i style="background:${c.hex}"></i><span>${esc(c.ar)}</span></button>`).join('');
      node.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
        node.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); v.colorKey = b.dataset.c; preview();
      });
      if (v.other) { node.querySelector('[data-make-other]').value = v.make; node.querySelector('[data-class-other]').value = v.model; }
      preview();
    })();

    return {
      node,
      value() {
        if (!v.makeId && !v.other) throw new Error('اختار شركة السيارة');
        if (v.makeId && !v.classId) throw new Error('اختار فئة السيارة');
        if (v.other && (!v.make || !v.model)) throw new Error('اكتب الشركة والفئة');
        if (!v.colorKey) throw new Error('اختار لون السيارة');
        return v.other
          ? { make: v.make, model: v.model, year: Number(v.year), colorKey: v.colorKey, transmission: v.transmission }
          : { makeId: v.makeId, classId: v.classId, year: Number(v.year), colorKey: v.colorKey, transmission: v.transmission };
      },
      suggestedSeats: () => (cl() ? cl().seats : null),
    };
  }
  S.vehiclePicker = vehiclePicker;

  /* ------------------------------ تسجيل الكابتن ------------------------------ */
  S.register = function () {
    const u = App.user || {};
    const node = el(`
      <section class="screen screen--scroll">
        <div class="pad-x" style="padding-top:calc(var(--safe-t) + var(--s-7))">
          <span class="cap-badge" style="display:inline-block;margin-bottom:var(--s-3)">كابتن نشمي</span>
          <h1 class="display">سجّل سيارتك</h1>
          <p class="muted" style="margin:var(--s-2) 0 var(--s-6)">دقيقة وحدة وبتبلّش تستقبل رحلات.</p>

          <label class="field"><span class="field__label">اسمك الكامل</span>
            <input class="input" id="cap-name" maxlength="60" value="${esc(u.name || '')}" placeholder="مثال: سامي المجالي" autocomplete="name"></label>

          <div class="field"><span class="field__label">نوع الخدمة</span>
            <div class="chips-wrap" data-types><span class="skeleton" style="width:100%;height:34px"></span></div></div>

          <div data-picker></div>

          <label class="field"><span class="field__label">رقم اللوحة</span>
            <input class="input num" id="cap-plate" maxlength="15" placeholder="10-12345" style="direction:ltr;text-align:start"></label>
          <p class="field__error hidden" data-err></p>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-save>تسجيل</button>
          <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-logout>خروج</button>
        </div>
      </section>`);

    let typeId = null;
    const err = node.querySelector('[data-err]');
    const picker = vehiclePicker();
    node.querySelector('[data-picker]').replaceWith(picker.node);

    (async () => {
      const box = node.querySelector('[data-types]');
      try {
        const { vehicleTypes } = await API.vehicleTypes();
        box.innerHTML = vehicleTypes.map((t, i) =>
          `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-type="${esc(t.id)}">${Icon(t.icon, 18)} ${esc(t.name_ar)}</button>`).join('');
        typeId = vehicleTypes[0] && vehicleTypes[0].id;
        box.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
          box.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); typeId = b.dataset.type;
        });
      } catch (e) { box.innerHTML = `<span class="sm muted-3">${esc(e.message)}</span>`; }
    })();

    node.querySelector('[data-logout]').onclick = () => App.logout();
    node.querySelector('[data-save]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      err.classList.add('hidden');
      let car;
      try { car = picker.value(); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); return; }
      busy(btn, true, 'جاري التسجيل');
      try {
        await API.cap.register({
          name: node.querySelector('#cap-name').value.trim(),
          vehicleTypeId: typeId, ...car,
          plate: node.querySelector('#cap-plate').value.trim(),
        });
        toast('تم تسجيلك ككابتن', 'success');
        await App.go('home');
      } catch (e) {
        err.textContent = e.message; err.classList.remove('hidden'); busy(btn, false);
      }
    };
    return node;
  };

  /** تعديل السيارة من الحساب (السيارات القديمة المكتوبة يدوي بتقدر تختار من الكتالوج) */
  S.editVehicle = function (vehicle) {
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('سيارتي')}
        <div class="pad-x" data-picker></div>
        <div class="pad-x"><p class="sm muted-3">رقم اللوحة ونوع الخدمة بتغيّرهم الإدارة — راسل الدعم الفني.</p></div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))"><button class="btn btn--primary" data-save>حفظ</button></div>
      </section>`);
    const picker = vehiclePicker(vehicle || {});
    node.querySelector('[data-picker]').appendChild(picker.node);
    wireBack(node, () => show(S.account()));
    node.querySelector('[data-save]').onclick = async (ev) => {
      let car;
      try { car = picker.value(); } catch (e) { return toast(e.message, 'error'); }
      busy(ev.currentTarget, true, 'جاري الحفظ');
      try { await API.cap.vehicle(car); toast('تم حفظ سيارتك', 'success'); show(S.account()); }
      catch (e) { toast(e.message, 'error'); busy(ev.currentTarget, false); }
    };
    return node;
  };

  /* ------------------------------ وثائق الكابتن ------------------------------ */
  const DOC_LABEL = { license: 'رخصة القيادة', id: 'الهوية الشخصية', registration: 'رخصة السيارة' };
  function docsBlock(documents) {
    const latest = {};
    for (const d of documents || []) if (!latest[d.kind]) latest[d.kind] = d;
    return `<div class="list" data-docs>${Object.keys(DOC_LABEL).map((k) => {
      const d = latest[k];
      const chip = !d ? '<span class="chip">مطلوبة</span>'
        : d.status === 'APPROVED' ? '<span class="chip chip--success">مقبولة</span>'
        : d.status === 'REJECTED' ? '<span class="chip chip--danger">مرفوضة</span>'
        : '<span class="chip chip--warning">قيد المراجعة</span>';
      return `<div class="list-item doc-row">
        <span class="list-item__icon">${Icon('doc', 20)}</span>
        <span class="list-item__body"><span class="list-item__title">${DOC_LABEL[k]}</span></span>
        ${chip}
        <button class="round-btn" data-doc="${k}" aria-label="رفع ${DOC_LABEL[k]}">${Icon('upload', 18)}</button>
      </div>`;
    }).join('')}</div><input type="file" accept="image/*" class="hidden" data-doc-file>`;
  }
  function wireDocs(node, onDone) {
    const file = node.querySelector('[data-doc-file]');
    let kind = null;
    node.querySelectorAll('[data-doc]').forEach((b) => b.onclick = () => { kind = b.dataset.doc; file.click(); });
    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f || !kind) return;
      try {
        const dataUrl = await UI.resizeImage(f, 1400);
        await API.cap.document(kind, dataUrl);
        toast('تم رفع ' + DOC_LABEL[kind], 'success');
        onDone && onDone();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  /* ------------------------------ قيد المراجعة ------------------------------ */
  S.pending = function (me) {
    const st = me.captain.status;
    const msg = {
      PENDING: ['حسابك قيد المراجعة', 'ارفع وثائقك تحت حتى نسرّع الموافقة. بنبلغك أول ما يتفعّل حسابك.'],
      REJECTED: ['لم تتم الموافقة على حسابك', 'تواصل مع الدعم لمعرفة السبب وتصحيح الوثائق.'],
      SUSPENDED: ['حسابك موقوف مؤقتاً', 'تواصل مع الدعم لإعادة التفعيل.'],
      BLOCKED: ['حسابك محظور', 'تواصل مع الدعم.'],
    }[st] || ['حالة الحساب: ' + st, ''];
    const node = el(`
      <section class="screen screen--scroll">
        <div class="pad-x" style="padding-top:calc(var(--safe-t) + var(--s-8))">
          <div class="center" style="width:74px;height:74px;border-radius:50%;background:var(--warning-100);color:var(--warning-500);margin-bottom:var(--s-5)">${Icon('clock', 34)}</div>
          <h1 class="h1">${esc(msg[0])}</h1>
          <p class="muted" style="margin:var(--s-2) 0 var(--s-6)">${esc(msg[1])}</p>
          <h3 class="h3" style="margin-bottom:var(--s-2)">الوثائق</h3>
          ${docsBlock(me.documents)}
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-refresh>تحديث الحالة</button>
          <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-logout>خروج</button>
        </div>
      </section>`);
    wireDocs(node, () => App.go('home'));
    node.querySelector('[data-refresh]').onclick = () => App.go('home');
    node.querySelector('[data-logout]').onclick = () => App.logout();
    return node;
  };

  /* ================================ الرئيسية ================================ */
  S.home = function () {
    const me = App.cap;
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="capMap"></div></div>
        <div class="cap-top">
          <button class="icon-btn" data-menu aria-label="حسابي">${Icon('menu', 22)}</button>
          <button class="earn-pill" data-earn aria-label="أرباح اليوم"><small>اليوم</small><span data-today>${esc(me.today.netText)}</span><small>د.أ</small></button>
          <button class="icon-btn" data-wallet aria-label="المحفظة">${Icon('wallet', 20)}</button>
          <button class="icon-btn has-badge" data-support aria-label="رسائل الإدارة">${Icon('chat', 20)}<span data-b-support></span></button>
        </div>
        <div data-warn></div>
        <div class="dock">
          <button class="icon-btn icon-btn--accent dock__fab" data-locate aria-label="موقعي">${Icon('navigate', 20)}</button>
          <div class="sheet sheet--docked" data-sheet></div>
        </div>
        <div data-offer-slot></div>
      </section>`);

    let map = null, meCar = null, offerLayers = [], pollTimer = null, meTimer = null, offerOpen = null;
    const sheet = node.querySelector('[data-sheet]');

    node.querySelector('[data-menu]').onclick = () => { stopAll(); show(S.account()); };
    node.querySelector('[data-earn]').onclick = () => { stopAll(); show(S.earnings()); };
    node.querySelector('[data-wallet]').onclick = () => { stopAll(); show(S.wallet()); };
    node.querySelector('[data-support]').onclick = () => { stopAll(); show(Inbox.support({ as: 'captain', back: () => App.go('home') })); };
    let badgeMounted = false;
    const syncBadges = async () => {
      if (node.isConnected) badgeMounted = true;
      else if (badgeMounted) return clearInterval(badgeTimer);
      else return;
      const c = await Inbox.counts('captain');
      node.querySelector('[data-b-support]').innerHTML = ChatUI.badge(c.support + c.notifications);
    };
    const badgeTimer = setInterval(syncBadges, 30000);
    UI.onLeave(node, () => clearInterval(badgeTimer));
    setTimeout(syncBadges, 50);
    node.querySelector('[data-locate]').onclick = () => {
      const p = CapKit.Location.get();
      if (p && map) map.flyTo([p.lat, p.lng], 16, { duration: .6 });
      else MapKit.locate().then((q) => map && map.flyTo([q.lat, q.lng], 16)).catch((e) => toast(e.message, 'error'));
    };

    function stopAll() { clearInterval(pollTimer); clearInterval(meTimer); pollTimer = null; }
    const unsubscribe = CapKit.Location.on((p) => {
      if (!map) return;
      if (meCar) meCar.glideTo(p, p.heading);
      else { meCar = MapKit.carMarker(map, p, p.heading); map.setView([p.lat, p.lng], 16); }
    });
    UI.onLeave(node, () => { stopAll(); unsubscribe(); closeOffer(); });

    setTimeout(async () => {
      map = MapKit.create(node.querySelector('#capMap'), { zoom: 15 });
      const p = CapKit.Location.get();
      if (p) { meCar = MapKit.carMarker(map, p, p.heading); map.setView([p.lat, p.lng], 16); }
      else MapKit.locate().then((q) => { if (!meCar) { meCar = MapKit.carMarker(map, q, 0); map.setView([q.lat, q.lng], 16); } }).catch(() => {});
    }, 30);

    function renderWarn() {
      const w = App.cap.wallet;
      node.querySelector('[data-warn]').innerHTML = w.canReceive ? '' : `
        <div class="wallet-warn">${Icon('alert', 20)}<span>رصيدك ${esc(w.balanceText)} د.أ — اشحن حتى تستقبل رحلات</span><button data-topup>اشحن</button></div>`;
      const b = node.querySelector('[data-topup]');
      if (b) b.onclick = () => { stopAll(); show(S.wallet()); };
    }

    function goalHtml() {
      const g = App.cap.captain.dailyGoalFils;
      const net = App.cap.today.netFils;
      if (!g) return `<button class="list-item" data-goal style="padding-inline:0">
          <span class="list-item__icon">${Icon('target', 20)}</span>
          <span class="list-item__body"><span class="list-item__title">حدد هدفك اليومي</span>
          <span class="list-item__sub">وبنوريك قديش ضايلك</span></span>
          <span class="list-item__end">${Icon('forward', 18)}</span></button>`;
      const pct = Math.min(100, Math.round((net / g) * 100));
      const left = Math.max(0, g - net);
      return `<button class="goal" data-goal style="width:100%;text-align:start;padding:var(--s-2) 0">
          <span style="color:var(--success-500);display:flex">${Icon('target', 22)}</span>
          <span class="grow" style="min-width:0">
            <span class="sm bold" style="display:block;margin-bottom:6px">${pct >= 100 ? 'حققت هدفك اليوم' : `ضايلك ${esc(CapKit.jod(left))} د.أ لهدفك`}</span>
            <span class="goal__bar"><i style="width:${pct}%"></i></span>
          </span>
          <span class="sm muted-3 num">${esc(CapKit.jod(g))}</span></button>`;
    }

    function renderSheet() {
      const online = App.online;
      const t = App.cap.today;
      if (!online) {
        sheet.innerHTML = `
          <div class="sheet__grip"></div>
          <div class="go-wrap"><button class="go-btn" data-go aria-label="اتصل وابدأ استقبال الرحلات">ابدأ</button></div>
          <h2 class="h2" style="text-align:center">أنت غير متصل</h2>
          <p class="muted sm" style="text-align:center;margin:4px 0 var(--s-4)">اضغط «ابدأ» لتستقبل رحلات قريبة منك</p>
          <div class="stat-row" style="margin-bottom:var(--s-3)">
            <div class="stat"><b>${t.trips}</b><span>رحلات اليوم</span></div>
            <div class="stat"><b>${esc(t.netText)}</b><span>صافي اليوم</span></div>
            <div class="stat"><b>${App.cap.captain.rating ? App.cap.captain.rating.toFixed(1) : '—'}</b><span>تقييمك</span></div>
          </div>
          ${goalHtml()}`;
        sheet.querySelector('[data-go]').onclick = (e) => goOnline(e.currentTarget);
      } else {
        sheet.innerHTML = `
          <div class="sheet__grip"></div>
          <div class="online-row">
            <span class="online-dot"></span>
            <div class="grow">
              <div class="bold" style="font-size:18px">أنت متصل</div>
              <div class="sm muted">نبحث لك عن رحلات قريبة…</div>
            </div>
            <button class="stop-btn" data-stop aria-label="إيقاف استقبال الرحلات">${Icon('power', 24)}</button>
          </div>
          <div class="scan-bar"><i></i></div>
          ${goalHtml()}
          <p class="xs muted-3" style="margin:var(--s-3) 0 0;text-align:center">خلي التطبيق مفتوح والشاشة شغالة حتى توصلك الطلبات</p>`;
        sheet.querySelector('[data-stop]').onclick = (e) => goOffline(e.currentTarget);
      }
      const g = sheet.querySelector('[data-goal]');
      if (g) g.onclick = editGoal;
    }

    /** أول مرة بتتصل: منقترح تفعيل الإشعارات عشان الطلبات توصل والشاشة مسكّرة */
    async function askPush() {
      const st = await PushKit.state();
      if (st !== 'off') return;
      try { if (localStorage.getItem('nashmi.pushAsked') === '1') return; localStorage.setItem('nashmi.pushAsked', '1'); } catch {}
      const sh = UI.sheet(`
        <div style="text-align:center;color:var(--brand-600);margin-bottom:var(--s-3)">${Icon('bell', 40)}</div>
        <h2 class="h2" style="text-align:center">خلّي الطلبات توصلك دايماً</h2>
        <p class="muted sm" style="text-align:center;margin:var(--s-2) 0 var(--s-5)">فعّل الإشعارات وبيوصلك تنبيه بكل طلب جديد حتى لو الشاشة مطفية أو التطبيق بالخلفية.</p>
        <button class="btn btn--primary" data-yes>تفعيل الإشعارات</button>
        <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-no>لاحقاً</button>`);
      sh.node.querySelector('[data-no]').onclick = sh.close;
      sh.node.querySelector('[data-yes]').onclick = async () => {
        try { const r = await PushKit.enable(); toast(r === 'on' ? 'تم — الطلبات رح توصلك بإشعار' : PushKit.TEXT[r], r === 'on' ? 'success' : ''); } catch (e) { toast(e.message, 'error'); }
        sh.close();
      };
    }

    async function goOnline(btn) {
      CapKit.Chime.unlock();
      busy(btn, true);
      try {
        await API.cap.online(true);
        App.setOnline(true);
        renderSheet(); startPolling();
        askPush();
      } catch (e) { toast(e.message, 'error'); busy(btn, false); await App.refreshMe(); renderWarn(); }
    }
    async function goOffline(btn) {
      busy(btn, true);
      try { await API.cap.online(false); } catch {}
      App.setOnline(false);
      stopAll(); closeOffer(); renderSheet();
    }

    function editGoal() {
      const cur = App.cap.captain.dailyGoalFils;
      const s = UI.sheet(`
        <h2 class="h2" style="margin-bottom:var(--s-2)">هدفك اليومي</h2>
        <p class="muted sm" style="margin:0 0 var(--s-4)">صافي الربح الي بدك توصله اليوم (بالدينار)</p>
        <div class="chips-wrap" style="margin-bottom:var(--s-3)">
          ${[10, 15, 20, 30].map((v) => `<button class="chip" data-v="${v}">${v} د.أ</button>`).join('')}
        </div>
        <input class="input num" id="goal-input" inputmode="decimal" placeholder="مثال: 20" value="${cur ? cur / 1000 : ''}" style="direction:ltr;text-align:start">
        <button class="btn btn--primary" style="margin-top:var(--s-4)" data-save>حفظ</button>
        ${cur ? '<button class="btn btn--ghost" style="margin-top:var(--s-3)" data-clear>إلغاء الهدف</button>' : ''}`);
      const input = s.node.querySelector('#goal-input');
      s.node.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { input.value = b.dataset.v; });
      const save = async (val) => {
        try { await API.cap.goal(val); await App.refreshMe(); s.close(); renderSheet(); }
        catch (e) { toast(e.message, 'error'); }
      };
      s.node.querySelector('[data-save]').onclick = () => {
        const v = Math.round(Number(input.value) * 1000);
        if (!v || v < 0) return toast('اكتب رقم صحيح', 'error');
        save(v);
      };
      const c = s.node.querySelector('[data-clear]'); if (c) c.onclick = () => save(null);
    }

    /* ---------------------------- استقبال العروض ---------------------------- */
    function startPolling() {
      CapKit.Location.start(); CapKit.Awake.on();
      clearInterval(pollTimer);
      pollTimer = setInterval(checkOffer, 2000);
      checkOffer();
    }

    async function checkOffer() {
      if (offerOpen || !App.online) return;
      try {
        const { offer } = await API.cap.offer();
        if (offer && !offerOpen) openOffer(offer);
      } catch (e) {
        if (e.code === 'WALLET_LOW' || e.code === 'CAPTAIN_NOT_APPROVED') { App.setOnline(false); renderSheet(); stopAll(); }
      }
    }

    function clearOfferLayers() { offerLayers.forEach((l) => l.remove()); offerLayers = []; }

    function openOffer(o) {
      offerOpen = o;
      CapKit.Chime.play();
      if (map) {
        clearOfferLayers();
        offerLayers.push(L.marker([o.pickup.lat, o.pickup.lng], { icon: MapKit.pickupIcon(`${o.pickupEtaMin} د`), interactive: false }).addTo(map));
        offerLayers.push(L.marker([o.destination.lat, o.destination.lng], { icon: MapKit.destIcon(), interactive: false }).addTo(map));
        const pts = [o.pickup, o.destination];
        const me = CapKit.Location.get(); if (me) pts.push(me);
        MapKit.frame(map, pts, { sheet: 430, top: 90 });
      }
      const R = 28, C = 2 * Math.PI * R;
      const host = el(`
        <div class="offer-host" role="dialog" aria-label="طلب رحلة جديد">
          <div class="offer">
            <div class="offer__head">
              <div class="ring" aria-hidden="true">
                <svg width="64" height="64" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="6"/>
                  <circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--success-500)" stroke-width="6" stroke-linecap="round"
                          stroke-dasharray="${C}" stroke-dashoffset="0" data-arc/>
                </svg>
                <b data-sec>${o.expiresInSec}</b>
              </div>
              <div class="grow" style="min-width:0">
                <div class="offer__net">${esc(o.netText)} <small>د.أ صافي لك</small></div>
                <div class="offer__meta">الأجرة ${esc(o.fareText)} · عمولة ${o.commissionPct}% · ${o.paymentMethod === 'CASH' ? 'كاش' : esc(o.paymentMethod)}</div>
              </div>
            </div>
            <div class="offer__legs">
              <div class="leg"><span class="leg__mark"></span><div class="leg__body">
                <div class="leg__title">${esc(o.pickup.address || 'نقطة الانطلاق')}</div>
                <div class="leg__sub">يبعد ${esc((o.pickupDistanceM / 1000).toFixed(1))} كم · ${o.pickupEtaMin} د · الزبون ${esc(o.customerName)}</div></div></div>
              <div class="leg"><span class="leg__mark leg__mark--dest"></span><div class="leg__body">
                <div class="leg__title">${esc(o.destination.address || 'الوجهة')}</div>
                <div class="leg__sub">الرحلة ${esc(o.tripDistanceKm)} كم · ${o.tripDurationMin} د</div></div></div>
            </div>
            <div class="offer__actions">
              <button class="btn btn--reject" data-reject>رفض</button>
              <button class="btn btn--accept" data-accept>قبول</button>
            </div>
          </div>
        </div>`);
      node.querySelector('[data-offer-slot]').replaceWith(host);
      host.setAttribute('data-offer-slot', '');

      const arc = host.querySelector('[data-arc]'), sec = host.querySelector('[data-sec]');
      const endAt = Date.now() + o.expiresInSec * 1000;
      const total = Math.max(o.totalSec, o.expiresInSec) * 1000;
      const tick = setInterval(() => {
        const left = Math.max(0, endAt - Date.now());
        sec.textContent = Math.ceil(left / 1000);
        arc.setAttribute('stroke-dashoffset', String(C * (1 - left / total)));
        if (left <= 0) { clearInterval(tick); closeOffer(); toast('انتهى وقت الطلب'); }
      }, 200);
      host._tick = tick;

      host.querySelector('[data-reject]').onclick = async () => {
        clearInterval(tick);
        API.cap.reject(o.id).catch(() => {});
        closeOffer();
      };
      host.querySelector('[data-accept]').onclick = async (e) => {
        clearInterval(tick);
        busy(e.currentTarget, true, 'جاري القبول');
        try {
          const { trip } = await API.cap.accept(o.id);
          stopAll(); offerOpen = null;
          show(CapScreens.trip(trip));
        } catch (err) {
          toast(err.message, 'error');
          closeOffer();
        }
      };
    }

    function closeOffer() {
      const host = node.querySelector('.offer-host');
      if (host) { clearInterval(host._tick); const slot = document.createElement('div'); slot.setAttribute('data-offer-slot', ''); host.replaceWith(slot); }
      offerOpen = null; clearOfferLayers();
    }

    renderWarn(); renderSheet();
    if (App.online) startPolling();
    meTimer = setInterval(async () => {
      await App.refreshMe().catch(() => {});
      if (!node.isConnected) return;
      node.querySelector('[data-today]').textContent = App.cap.today.netText;
      renderWarn();
      if (!offerOpen) renderSheet();
    }, 60000);
    return node;
  };

  /* ================================= الأرباح ================================= */
  S.earnings = function (range = 'today') {
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('أرباحي')}
        <div class="pad-x">
          <div class="seg" style="margin-bottom:var(--s-5)">
            <button data-r="today" class="${range === 'today' ? 'on' : ''}">اليوم</button>
            <button data-r="week" class="${range === 'week' ? 'on' : ''}">آخر 7 أيام</button>
          </div>
          <div data-body><div class="skeleton" style="height:120px"></div></div>
        </div>
      </section>`);
    wireBack(node, () => App.go('home'));
    node.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => show(S.earnings(b.dataset.r)));

    (async () => {
      const box = node.querySelector('[data-body]');
      try {
        const e = await API.cap.earnings(range);
        box.innerHTML = `
          <div class="sm muted">صافي ربحك</div>
          <div class="big-balance">${esc(e.netText)} <small class="muted" style="font-size:16px">د.أ</small></div>
          <div class="stat-row" style="margin:var(--s-4) 0 var(--s-6)">
            <div class="stat"><b>${e.trips.length}</b><span>رحلة</span></div>
            <div class="stat"><b>${esc(e.grossText)}</b><span>قبضت كاش</span></div>
            <div class="stat"><b>${esc(e.commissionText)}</b><span>عمولة نشمي</span></div>
          </div>
          <h3 class="h3" style="margin-bottom:var(--s-2)">الرحلات</h3>
          ${e.trips.length ? `<div class="list">${e.trips.map((t) => `
            <div class="list-item" style="align-items:flex-start">
              <span class="list-item__icon">${Icon('car', 20)}</span>
              <span class="list-item__body">
                <span class="list-item__title">${esc(t.destAddress || 'رحلة')}</span>
                <span class="list-item__sub">${esc(UI.dateText(t.completedAt))} · ${esc(t.distanceKm)} كم · قبضت ${esc(t.grossText)}</span>
              </span>
              <span class="list-item__end amt-pos">+${esc(t.netText)}</span>
            </div>`).join('')}</div>`
          : `<div class="empty"><div class="empty__icon">${Icon('chart', 64)}</div><p>ما في رحلات بهالفترة</p></div>`}`;
      } catch (err) { box.innerHTML = `<p class="sm muted-3">${esc(err.message)}</p>`; }
    })();
    return node;
  };

  /* ================================= المحفظة ================================= */
  S.wallet = function () {
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('المحفظة')}
        <div class="pad-x" data-body><div class="skeleton" style="height:140px"></div></div>
      </section>`);
    wireBack(node, () => App.go('home'));

    (async () => {
      const box = node.querySelector('[data-body]');
      try {
        const w = await API.cap.wallet();
        const statusChip = (s) => s === 'APPROVED' ? '<span class="chip chip--success">تمت الإضافة</span>'
          : s === 'REJECTED' ? '<span class="chip chip--danger">مرفوض</span>' : '<span class="chip chip--warning">قيد المراجعة</span>';
        box.innerHTML = `
          <div class="card" style="margin-bottom:var(--s-4)">
            <div class="sm muted">رصيدك الحالي</div>
            <div class="big-balance ${w.balanceFils < 0 ? 'neg' : ''}">${esc(w.balanceText)} <small class="muted" style="font-size:16px">د.أ</small></div>
            <p class="sm muted" style="margin:var(--s-2) 0 var(--s-4)">
              عمولة نشمي على كل رحلة كاش بتنخصم من هون تلقائياً. بتقدر تستقبل رحلات لحد ما يوصل رصيدك
              <b class="num">${esc(w.minBalanceText)}</b> د.أ.
            </p>
            <button class="btn btn--primary" data-topup>${Icon('plus', 18)} شحن الرصيد عبر CliQ</button>
          </div>
          ${w.deposits.length ? `<h3 class="h3" style="margin-bottom:var(--s-2)">طلبات الشحن</h3>
            <div class="list" style="margin-bottom:var(--s-5)">${w.deposits.map((d) => `
              <div class="list-item"><span class="list-item__icon">${Icon('upload', 20)}</span>
                <span class="list-item__body"><span class="list-item__title num">${esc(d.amountText)} د.أ</span>
                <span class="list-item__sub">${esc(UI.dateText(d.createdAt))}${d.rejectReason ? ' · ' + esc(d.rejectReason) : ''}</span></span>
                ${statusChip(d.status)}</div>`).join('')}</div>` : ''}
          <h3 class="h3" style="margin-bottom:var(--s-2)">الحركات</h3>
          ${w.transactions.length ? `<div class="list">${w.transactions.map((t) => `
            <div class="list-item" style="align-items:flex-start">
              <span class="list-item__icon">${Icon(t.amountFils < 0 ? 'receipt' : 'wallet', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">${esc(t.label)}</span>
                <span class="list-item__sub">${esc(t.description || '')}</span>
                <span class="list-item__sub">${esc(UI.dateText(t.createdAt))} · <span class="num">${esc(t.id)}</span></span></span>
              <span class="list-item__end" style="text-align:end">
                <span class="${t.amountFils < 0 ? 'amt-neg' : 'amt-pos'}">${t.amountFils > 0 ? '+' : ''}${esc(t.amountText)}</span>
                <span class="xs muted-3" style="display:block">الرصيد ${esc(t.balanceAfterText)}</span></span>
            </div>`).join('')}</div>`
          : `<div class="empty"><div class="empty__icon">${Icon('wallet', 64)}</div><p>ما في حركات بعد</p></div>`}`;
        box.querySelector('[data-topup]').onclick = () => show(S.topup(w));
      } catch (err) { box.innerHTML = `<p class="sm muted-3">${esc(err.message)}</p>`; }
    })();
    return node;
  };

  S.topup = function (w) {
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('شحن الرصيد')}
        <div class="pad-x">
          <p class="muted" style="margin:0 0 var(--s-3)">1. حوّل المبلغ عبر CliQ من تطبيق بنكك إلى:</p>
          ${w.cliqAlias
            ? `<div class="cliq"><div><div class="xs muted-3">اسم CliQ</div><b>${esc(w.cliqAlias)}</b></div>
                 <button class="btn btn--sm btn--ghost" data-copy>نسخ</button></div>`
            : `<div class="card" style="background:var(--warning-100);border-color:transparent;margin:var(--s-3) 0">
                 <p class="sm bold" style="margin:0">اسم CliQ للشركة ما انضبط بعد. تواصل مع الإدارة قبل التحويل.</p></div>`}
          <p class="muted" style="margin:var(--s-5) 0 var(--s-3)">2. المبلغ الي حوّلته:</p>
          <div class="chips-wrap" style="margin-bottom:var(--s-3)">
            ${[1, 2, 5, 10, 20].map((v) => `<button class="chip" data-v="${v}">${v} د.أ</button>`).join('')}
          </div>
          <input class="input num" id="dep-amount" inputmode="decimal" placeholder="المبلغ بالدينار" style="direction:ltr;text-align:start">
          <p class="muted" style="margin:var(--s-5) 0 var(--s-3)">3. صورة إشعار التحويل:</p>
          <button class="proof" data-pick>${Icon('camera', 28)}<span>اختر صورة الإشعار</span></button>
          <input type="file" accept="image/*" class="hidden" data-file>
          <p class="sm muted-3" style="margin-top:var(--s-4)">الإدارة بتراجع الطلب وبتضيف المبلغ لرصيدك. ما بينضاف شي قبل المراجعة.</p>
          <p class="field__error hidden" data-err></p>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-send>إرسال للمراجعة</button>
        </div>
      </section>`);
    wireBack(node, () => show(S.wallet()));
    const input = node.querySelector('#dep-amount'), err = node.querySelector('[data-err]');
    const file = node.querySelector('[data-file]'), pick = node.querySelector('[data-pick]');
    let proof = null;
    node.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { input.value = b.dataset.v; });
    const copy = node.querySelector('[data-copy]');
    if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(w.cliqAlias); toast('تم النسخ', 'success'); } catch { toast(w.cliqAlias); } };
    pick.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0]; if (!f) return;
      try { proof = await UI.resizeImage(f, 1400); pick.innerHTML = `<img src="${proof}" alt="إشعار التحويل"><span class="sm">تغيير الصورة</span>`; }
      catch (e) { toast(e.message, 'error'); }
    };
    node.querySelector('[data-send]').onclick = async (ev) => {
      err.classList.add('hidden');
      const amount = Math.round(Number(input.value) * 1000);
      if (!amount) { err.textContent = 'اكتب المبلغ'; err.classList.remove('hidden'); return; }
      if (!proof) { err.textContent = 'أضف صورة إشعار التحويل'; err.classList.remove('hidden'); return; }
      const btn = ev.currentTarget; busy(btn, true, 'جاري الإرسال');
      try { await API.cap.deposit(amount, proof); toast('وصل طلبك للإدارة', 'success'); show(S.wallet()); }
      catch (e) { err.textContent = e.message; err.classList.remove('hidden'); busy(btn, false); }
    };
    return node;
  };

  /* ================================= الحساب ================================= */
  S.account = function () {
    const me = App.cap, u = App.user || {}, c = me.captain, v = me.vehicle;
    const theme = UI.getTheme(), nav = CapKit.navPref();
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('حسابي')}
        <div class="pad-x">
          <div class="card row" style="gap:var(--s-4)">
            <div class="avatar-edit" style="width:60px;margin:0">
              ${UI.avatar(u, 'avatar--md')}
              <button class="avatar-edit__btn" style="width:28px;height:28px" data-photo aria-label="تغيير الصورة">${Icon('camera', 14)}</button>
            </div>
            <input type="file" accept="image/*" class="hidden" data-photo-file>
            <div class="grow" style="min-width:0">
              <div class="bold" style="font-size:18px">${esc(u.name || '')}</div>
              <div class="sm muted-3 num" style="direction:ltr;text-align:start">${esc(u.phone || '')}</div>
            </div>
          </div>
          <div class="stat-row" style="margin:var(--s-4) 0">
            <div class="stat"><b>${c.rating ? c.rating.toFixed(1) : '—'}</b><span>التقييم</span></div>
            <div class="stat"><b>${c.tripsCompleted}</b><span>رحلة مكتملة</span></div>
            <div class="stat"><b>${c.acceptanceRate === null ? '—' : c.acceptanceRate + '%'}</b><span>نسبة القبول</span></div>
          </div>

          ${v ? `<h3 class="h3" style="margin-bottom:var(--s-2)">سيارتك — هيك بيشوفها الزبون</h3>
            <div class="card" style="margin-bottom:var(--s-2)">${CarArt.card(v)}
              <div class="sm muted-3" style="text-align:center;margin-top:var(--s-2)">${esc(v.typeName || '')}</div></div>
            <button class="btn btn--ghost btn--sm" style="width:100%;margin-bottom:var(--s-5)" data-edit-car>${Icon('edit', 16)} ${v.makeId ? 'تعديل السيارة' : 'اختار سيارتك من القائمة (الشركة والفئة)'}</button>` : ''}

          <div class="list" style="margin-bottom:var(--s-5)">
            <button class="list-item" data-notifs><span class="list-item__icon">${Icon('bell', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">الإشعارات</span><span class="list-item__sub">تنبيهات الطلبات ورسائل الإدارة</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span></button>
            <button class="list-item" data-support><span class="list-item__icon">${Icon('chat', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">راسل الإدارة</span><span class="list-item__sub">المحفظة، الوثائق، إبلاغ عن زبون…</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span></button>
          </div>

          <h3 class="h3" style="margin-bottom:var(--s-2)">الوثائق</h3>
          ${docsBlock(me.documents)}

          <h3 class="h3" style="margin:var(--s-5) 0 var(--s-2)">الملاحة</h3>
          <div class="seg" data-nav>
            <button data-v="google" class="${nav === 'google' ? 'on' : ''}">Google Maps</button>
            <button data-v="waze" class="${nav === 'waze' ? 'on' : ''}">Waze</button>
            <button data-v="" class="${!nav ? 'on' : ''}">اسألني</button>
          </div>

          <h3 class="h3" style="margin:var(--s-5) 0 var(--s-2)">المظهر</h3>
          <div class="seg" data-theme>
            <button data-v="light" class="${theme === 'light' ? 'on' : ''}">فاتح</button>
            <button data-v="dark" class="${theme === 'dark' ? 'on' : ''}">داكن</button>
            <button data-v="system" class="${theme === 'system' ? 'on' : ''}">حسب الجهاز</button>
          </div>

          <button class="btn btn--ghost" style="margin:var(--s-6) 0 var(--s-3)" data-logout>${Icon('logout', 18)} تسجيل الخروج</button>
          <p class="xs muted-3" style="text-align:center;padding-bottom:calc(var(--s-6) + var(--safe-b))">نشمي كابتن · النسخة 0.6</p>
        </div>
      </section>`);
    wireBack(node, () => App.go('home'));
    wireDocs(node, async () => { await App.refreshMe(); show(S.account()); });
    const acc = () => show(S.account());
    const ec = node.querySelector('[data-edit-car]');
    if (ec) ec.onclick = () => show(S.editVehicle(v));
    node.querySelector('[data-notifs]').onclick = () => show(Inbox.notifications({ as: 'captain', back: acc }));
    node.querySelector('[data-support]').onclick = () => show(Inbox.support({ as: 'captain', back: acc }));

    node.querySelectorAll('[data-nav] [data-v]').forEach((b) => b.onclick = () => { CapKit.setNavPref(b.dataset.v); show(S.account()); });
    node.querySelectorAll('[data-theme] [data-v]').forEach((b) => b.onclick = () => {
      UI.setTheme(b.dataset.v); API.updateMe({ theme: b.dataset.v }).catch(() => {}); show(S.account());
    });
    const pf = node.querySelector('[data-photo-file]');
    node.querySelector('[data-photo]').onclick = () => pf.click();
    pf.onchange = async () => {
      const f = pf.files && pf.files[0]; if (!f) return;
      try { const d = await UI.resizeImage(f); const r = await API.uploadPhoto(d); App.setUser(r.user); show(S.account()); toast('تم تحديث الصورة', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    };
    node.querySelector('[data-logout]').onclick = async () => {
      if (App.online) return toast('أوقف استقبال الرحلات أولاً', 'error');
      const yes = await UI.confirm({ title: 'تسجيل الخروج؟', confirmText: 'خروج', danger: true });
      if (yes) App.logout();
    };
    return node;
  };
})();
