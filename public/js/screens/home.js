/* الشاشة الرئيسية + اختيار الوجهة + تأكيد نقطة الانطلاق */
window.Screens = window.Screens || {};

(function () {
  const { el, esc, show, toast } = UI;

  /* ------------------------------ الرئيسية ------------------------------ */
  Screens.home = function homeScreen() {
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="homeMap"></div></div>

        <div class="topbar topbar--floating">
          <button class="icon-btn" data-menu aria-label="حسابي">${Icon('menu', 22)}</button>
          <button class="icon-btn" data-notif aria-label="رحلاتي">${Icon('receipt', 20)}</button>
          <div class="spacer"></div>
        </div>

        <div class="dock">
          <button class="icon-btn icon-btn--accent dock__fab" data-locate aria-label="موقعي الحالي">
            ${Icon('navigate', 20)}
          </button>
          <div class="sheet sheet--docked" data-sheet>
          <div class="sheet__grip"></div>
          <div class="row" style="margin-bottom:var(--s-4)">
            <div class="grow">
              <div class="sm muted-3">مرحباً${App.user && App.user.name ? '، ' + esc(App.user.name.split(' ')[0]) : ''}</div>
              <h2 class="h2">وين رايح اليوم؟</h2>
            </div>
            ${UI.avatar(App.user)}
          </div>

          <button class="input row" data-where
                  style="justify-content:flex-start;gap:var(--s-3);color:var(--text-3);font-weight:600;text-align:start">
            <span style="color:var(--accent-500);display:flex">${Icon('search', 20)}</span>
            <span class="grow">إلى أين؟</span>
            <span style="color:var(--text-3);display:flex">${Icon('forward', 18)}</span>
          </button>

          <div class="list" data-places style="margin-top:var(--s-3)">
            <div class="skeleton" style="height:56px;margin:var(--s-2) 0"></div>
            <div class="skeleton" style="height:56px;margin:var(--s-2) 0"></div>
          </div>
          </div>
        </div>
      </section>`);

    let map, meMarker;
    let current = null;
    const cars = new Map();       // سيارات حقيقية متصلة قريبة (من الخادم)
    let carsTimer = null;

    /** السيارات القريبة المتصلة فعلاً — لا توجد سيارات وهمية */
    async function refreshCars() {
      if (!map || !node.isConnected) { clearInterval(carsTimer); return; }
      const c = current || map.getCenter();
      try {
        const { captains } = await API.nearbyCaptains(c.lat, c.lng);
        const seen = new Set();
        for (const cap of captains) {
          seen.add(cap.id);
          const old = cars.get(cap.id);
          if (old) old.glideTo(cap, cap.heading);
          else cars.set(cap.id, MapKit.carMarker(map, cap, cap.heading));
        }
        for (const [id, m] of cars) if (!seen.has(id)) { m.remove(); cars.delete(id); }
      } catch { /* نعيد المحاولة بالدورة القادمة */ }
    }

    const boot = async () => {
      map = MapKit.create(node.querySelector('#homeMap'), { zoom: 15 });
      App.map = map;
      refreshCars();
      carsTimer = setInterval(refreshCars, 8000);
      try {
        const pos = await MapKit.locate();
        current = pos;
        App.pickup = { ...pos, label: 'موقعي الحالي' };
        meMarker = L.marker([pos.lat, pos.lng], { icon: MapKit.meIcon(), interactive: false }).addTo(map);
        map.flyTo([pos.lat, pos.lng], 16, { duration: .9 });
        refreshCars();
        const rev = await MapKit.reverse(pos.lat, pos.lng);
        if (rev) App.pickup = { ...pos, label: rev.label, address: rev.address };
      } catch (e) {
        toast(e.message);
      }
    };
    setTimeout(boot, 30);

    node.querySelector('[data-locate]').onclick = async () => {
      try {
        const pos = await MapKit.locate();
        current = pos;
        App.pickup = { ...pos, label: 'موقعي الحالي' };
        if (meMarker) meMarker.setLatLng([pos.lat, pos.lng]);
        else meMarker = L.marker([pos.lat, pos.lng], { icon: MapKit.meIcon(), interactive: false }).addTo(map);
        map.flyTo([pos.lat, pos.lng], 16, { duration: .7 });
        const rev = await MapKit.reverse(pos.lat, pos.lng);
        if (rev) App.pickup = { ...pos, label: rev.label, address: rev.address };
      } catch (e) { toast(e.message, 'error'); }
    };

    node.querySelector('[data-menu]').onclick = () => show(Screens.account());
    node.querySelector('[data-notif]').onclick = () => show(Screens.trips());
    node.querySelector('[data-where]').onclick = () => show(Screens.destination());

    // الأماكن المحفوظة والوجهات الأخيرة
    (async () => {
      const box = node.querySelector('[data-places]');
      try {
        const { saved, recent } = await API.places();
        const items = [];
        const home = saved.find((s) => s.kind === 'home');
        const work = saved.find((s) => s.kind === 'work');
        items.push(quick('home', 'البيت', home));
        items.push(quick('work', 'الشغل', work));
        for (const r of recent.slice(0, 3)) {
          items.push(`<button class="list-item" data-go='${esc(JSON.stringify({ lat: r.lat, lng: r.lng, label: r.label, address: r.address }))}'>
            <span class="list-item__icon">${Icon('clock', 20)}</span>
            <span class="list-item__body">
              <span class="list-item__title">${esc(r.label)}</span>
              <span class="list-item__sub">${esc(r.address || '')}</span>
            </span>
          </button>`);
        }
        box.innerHTML = items.join('');
        box.querySelectorAll('[data-go]').forEach((b) => {
          b.onclick = () => {
            App.destination = JSON.parse(b.dataset.go);
            show(Screens.confirmPickup());
          };
        });
        box.querySelectorAll('[data-add]').forEach((b) => {
          b.onclick = () => { App.savingKind = b.dataset.add; show(Screens.destination({ mode: 'save', kind: b.dataset.add })); };
        });
      } catch (e) {
        box.innerHTML = `<p class="sm muted-3">${esc(e.message)}</p>`;
      }
    })();

    function quick(kind, label, place) {
      if (place) {
        return `<button class="list-item" data-go='${esc(JSON.stringify({ lat: place.lat, lng: place.lng, label: place.label, address: place.address }))}'>
          <span class="list-item__icon list-item__icon--brand">${Icon(kind === 'home' ? 'home' : 'work', 20)}</span>
          <span class="list-item__body">
            <span class="list-item__title">${esc(place.label)}</span>
            <span class="list-item__sub">${esc(place.address || '')}</span>
          </span>
        </button>`;
      }
      return `<button class="list-item" data-add="${kind}">
        <span class="list-item__icon">${Icon(kind === 'home' ? 'home' : 'work', 20)}</span>
        <span class="list-item__body">
          <span class="list-item__title">${esc(label)}</span>
          <span class="list-item__sub">أضف العنوان</span>
        </span>
        <span class="list-item__end">${Icon('plus', 18)}</span>
      </button>`;
    }

    return node;
  };

  /* --------------------------- اختيار الوجهة --------------------------- */
  Screens.destination = function destinationScreen({ mode = 'ride', kind = null } = {}) {
    const node = el(`
      <section class="screen">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="topbar__title">${mode === 'save' ? (kind === 'home' ? 'عنوان البيت' : kind === 'work' ? 'عنوان الشغل' : 'مكان جديد') : 'إلى أين؟'}</div>
          <span style="width:44px"></span>
        </div>

        <div class="pad-x">
          <div class="route-line" style="margin-bottom:var(--s-4)">
            <div class="route-line__rail">
              <span class="route-line__dot"></span>
              <span class="route-line__bar"></span>
              <span class="route-line__dot route-line__dot--end"></span>
            </div>
            <div class="route-line__labels">
              <div class="sm">
                <div class="muted-3 xs">من</div>
                <div class="bold" data-from>${esc((App.pickup && App.pickup.label) || 'موقعي الحالي')}</div>
              </div>
              <input class="input input--box" data-q placeholder="اكتب اسم المكان أو المنطقة" autocomplete="off"
                     style="min-height:48px;font-weight:600">
            </div>
          </div>
        </div>

        <div class="pad-x grow" style="overflow-y:auto">
          <button class="list-item" data-onmap>
            <span class="list-item__icon list-item__icon--accent">${Icon('pin', 20)}</span>
            <span class="list-item__body"><span class="list-item__title">حدد على الخريطة</span>
            <span class="list-item__sub">اسحب الدبوس على المكان بالضبط</span></span>
            <span class="list-item__end">${Icon('forward', 18)}</span>
          </button>
          <div class="list" data-results></div>
        </div>
      </section>`);

    const q = node.querySelector('[data-q]');
    const results = node.querySelector('[data-results]');
    node.querySelector('[data-back]').onclick = () => show(Screens.home());

    const choose = (place) => {
      if (mode === 'save') {
        show(Screens.pickOnMap({
          center: place, mode: 'save', kind,
          onDone: async (p) => {
            const label = kind === 'home' ? 'البيت' : kind === 'work' ? 'الشغل' : (p.label || 'مكان محفوظ').slice(0, 60);
            await API.savePlace({ kind, label, address: p.address, lat: p.lat, lng: p.lng });
            toast('تم حفظ العنوان', 'success');
            show(Screens.home());
          },
        }));
        return;
      }
      App.destination = place;
      show(Screens.confirmPickup());
    };

    let timer = null;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      const text = q.value.trim();
      if (text.length < 2) { results.innerHTML = ''; return; }
      results.innerHTML = `<div class="skeleton" style="height:56px;margin:var(--s-2) 0"></div>
                           <div class="skeleton" style="height:56px;margin:var(--s-2) 0"></div>`;
      timer = setTimeout(async () => {
        try {
          const rows = await MapKit.search(text, App.pickup || MapKit.KARAK);
          if (!rows.length) {
            results.innerHTML = `<div class="empty"><div class="empty__icon">${Icon('search', 64)}</div>
              <p>ما لقينا نتيجة لـ "${esc(text)}"</p><p class="sm">جرّب اسماً أوضح أو حدد على الخريطة</p></div>`;
            return;
          }
          results.innerHTML = rows.map((r, i) => `
            <button class="list-item" data-i="${i}">
              <span class="list-item__icon">${Icon('pin', 20)}</span>
              <span class="list-item__body">
                <span class="list-item__title">${esc(r.label)}</span>
                <span class="list-item__sub">${esc(r.address)}</span>
              </span>
            </button>`).join('');
          results.querySelectorAll('[data-i]').forEach((b) => {
            b.onclick = () => choose(rows[Number(b.dataset.i)]);
          });
        } catch (e) {
          results.innerHTML = `<p class="sm muted-3 pad">${esc(e.message)}</p>`;
        }
      }, 420);
    });

    node.querySelector('[data-onmap]').onclick = () => show(Screens.pickOnMap({
      center: App.pickup || MapKit.KARAK, mode,
      onDone: (p) => choose(p),
    }));

    setTimeout(() => q.focus(), 250);
    return node;
  };

  /* ------------------------- التحديد على الخريطة ------------------------- */
  Screens.pickOnMap = function pickOnMapScreen({ center, onDone, mode = 'ride', kind = null }) {
    const title = mode === 'save' ? 'ثبّت العنوان' : 'حدد المكان';
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="pickMap"></div></div>

        <div data-pin-slot></div>

        <div class="topbar topbar--floating">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
        </div>

        <div class="sheet">
          <div class="sheet__grip"></div>
          <div class="row" style="align-items:flex-start;margin-bottom:var(--s-4)">
            <span class="list-item__icon list-item__icon--accent">${Icon('pin', 20)}</span>
            <div class="grow" style="min-width:0">
              <div class="sm muted-3">${esc(title)}</div>
              <div class="bold" data-label style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">جاري تحديد العنوان…</div>
            </div>
          </div>
          <button class="btn btn--primary" data-confirm>تأكيد الموقع</button>
        </div>
      </section>`);

    let map, picked = { lat: center.lat, lng: center.lng, label: '', address: '' };
    const labelEl = node.querySelector('[data-label]');
    node.querySelector('[data-back]').onclick = () => history.back ? show(Screens.destination({ mode, kind })) : show(Screens.home());

    const pin = MapKit.centerPin('');
    node.querySelector('[data-pin-slot]').replaceWith(pin.node);

    setTimeout(() => {
      map = MapKit.create(node.querySelector('#pickMap'), { center, zoom: 17 });
      const update = async (c) => {
        picked.lat = c.lat; picked.lng = c.lng;
        labelEl.textContent = 'جاري تحديد العنوان…';
        const rev = await MapKit.reverse(c.lat, c.lng);
        picked.label = (rev && rev.label) || 'موقع محدد على الخريطة';
        picked.address = (rev && rev.address) || '';
        labelEl.textContent = picked.label;
      };
      map.on('movestart', () => { labelEl.textContent = '…'; });
      MapKit.bindCenterPin(map, pin, update);
      update(map.getCenter());
    }, 30);

    node.querySelector('[data-confirm]').onclick = () => onDone(picked);
    return node;
  };

  /* --------------------- تأكيد نقطة الانطلاق ثم السعر --------------------- */
  Screens.confirmPickup = function confirmPickupScreen() {
    const start = App.pickup || MapKit.KARAK;
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="cpMap"></div></div>

        <div data-pin-slot></div>

        <div class="topbar topbar--floating">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
        </div>

        <div class="sheet">
          <div class="sheet__grip"></div>
          <div class="row" style="align-items:flex-start;margin-bottom:var(--s-4)">
            <span class="list-item__icon list-item__icon--accent">${Icon('pin', 20)}</span>
            <div class="grow" style="min-width:0">
              <div class="sm muted-3">مكان الانطلاق</div>
              <div class="bold" data-label style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(start.label || 'حدد نقطة الانطلاق')}</div>
              <div class="sm muted-3" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                إلى: ${esc((App.destination && (App.destination.label || App.destination.address)) || '')}
              </div>
            </div>
          </div>
          <button class="btn btn--primary" data-confirm>تأكيد الطلب</button>
        </div>
      </section>`);

    let map, picked = { ...start };
    const labelEl = node.querySelector('[data-label]');
    node.querySelector('[data-back]').onclick = () => show(Screens.destination());

    // دبوس بستايل أوبر مع بطاقة «الانطلاق من هنا»
    const pin = MapKit.centerPin('الانطلاق من هنا');
    node.querySelector('[data-pin-slot]').replaceWith(pin.node);

    setTimeout(() => {
      map = MapKit.create(node.querySelector('#cpMap'), { center: start, zoom: 17.5 });
      if (App.destination) {
        L.marker([App.destination.lat, App.destination.lng], { icon: MapKit.destIcon(), interactive: false }).addTo(map);
      }
      MapKit.bindCenterPin(map, pin, async (c) => {
        picked.lat = c.lat; picked.lng = c.lng;
        const rev = await MapKit.reverse(c.lat, c.lng);
        picked.label = (rev && rev.label) || 'موقع محدد';
        picked.address = (rev && rev.address) || '';
        labelEl.textContent = picked.label;
      });
    }, 30);

    node.querySelector('[data-confirm]').onclick = () => {
      App.pickup = picked;
      show(Screens.rideOptions());
    };
    return node;
  };
})();
