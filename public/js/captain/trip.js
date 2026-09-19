/* ==========================================================
   رحلة الكابتن: الطريق للزبون ← الانتظار ← الرحلة ← الملخص والتحصيل.
   ========================================================== */
window.CapScreens = window.CapScreens || {};

(function () {
  const { el, esc, show, toast, busy } = UI;
  const S = CapScreens;

  const NEAR_M = 70;   // «أنت عند الزبون» — تنبيه تلقائي

  S.trip = function (trip) {
    let t = trip;
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="tripMap"></div></div>
        <div data-banner></div>
        <div class="sheet" data-panel></div>
      </section>`);

    let map = null, meCar = null, targetMarker = null, route = null, routeFor = null;
    let poll = null, clock = null, nearNotified = false, lastPos = CapKit.Location.get();

    CapKit.Location.start(); CapKit.Awake.on(); CapKit.Location.sendNow();

    const target = () => (t.status === 'TRIP_STARTED' ? t.destination : t.pickup);
    const stage = () => (t.status === 'TRIP_STARTED' ? 'dest' : t.status === 'DRIVER_ARRIVED' ? 'wait' : 'pickup');

    /* ----------------------------- الخريطة ----------------------------- */
    setTimeout(() => {
      map = MapKit.create(node.querySelector('#tripMap'), { center: lastPos || t.pickup, zoom: 15 });
      if (lastPos) meCar = MapKit.carMarker(map, lastPos, lastPos.heading);
      drawTarget();
    }, 30);

    async function drawTarget() {
      if (!map) return;
      const tg = target(), key = stage() + ':' + tg.lat + ',' + tg.lng;
      if (targetMarker) targetMarker.remove();
      targetMarker = L.marker([tg.lat, tg.lng], {
        icon: t.status === 'TRIP_STARTED' ? MapKit.destIcon() : MapKit.pickupIcon(t.customer.firstName), interactive: false,
      }).addTo(map);
      const from = lastPos || (t.status === 'TRIP_STARTED' ? t.pickup : null);
      if (!from || routeFor === key) { MapKit.frame(map, [tg, ...(from ? [from] : [])], { sheet: MapKit.sheetHeight(node), top: 120 }); return; }
      routeFor = key;
      if (route) route.remove();
      route = await MapKit.route(map, from, tg);
      if (node.isConnected) MapKit.frame(map, route.bounds, { sheet: MapKit.sheetHeight(node), top: 120 });
    }

    const unsubscribe = CapKit.Location.on((p) => {
      lastPos = p;
      if (map) { if (meCar) meCar.glideTo(p, p.heading); else meCar = MapKit.carMarker(map, p, p.heading); }
      if (!routeFor && map) drawTarget();
      if ((t.status === 'DRIVER_ARRIVING' || t.status === 'DRIVER_ACCEPTED') && !nearNotified
          && CapKit.distance(p, t.pickup) <= NEAR_M) {
        nearNotified = true;
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        render();
      }
    });

    /* ----------------------------- الشريط العلوي ----------------------------- */
    function renderBanner() {
      const tg = target();
      const label = t.status === 'TRIP_STARTED' ? 'إلى الوجهة' : 'إلى الزبون';
      node.querySelector('[data-banner]').innerHTML = t.status === 'DRIVER_ARRIVED' ? '' : `
        <div class="nav-banner">
          <span class="nav-banner__back">${Icon('navigate', 22)}</span>
          <div class="nav-banner__body">
            <div class="nav-banner__label">${label}</div>
            <div class="nav-banner__addr">${esc(tg.address || 'على الخريطة')}</div>
          </div>
          <button class="nav-banner__go" data-nav>${Icon('navigate', 16)} ملاحة</button>
        </div>`;
      const b = node.querySelector('[data-nav]');
      if (b) b.onclick = () => CapKit.navigate(tg);
    }

    /* ----------------------------- اللوح السفلي ----------------------------- */
    function custRow() {
      const c = t.customer || {};
      return `<div class="cust">
        ${UI.avatar({ name: c.name, photoUrl: c.photoUrl }, 'avatar--md')}
        <div class="grow" style="min-width:0">
          <div class="cust__name">${esc(c.firstName || 'الزبون')}</div>
          <div class="sm muted-3">${esc(t.code)} · ${esc(t.estFareText)} د.أ كاش</div>
        </div>
        ${c.phone ? `<a class="round-btn round-btn--call" href="tel:${esc(c.phone)}" aria-label="اتصال بالزبون">${Icon('phone', 20)}</a>` : ''}
        <button class="round-btn" data-more aria-label="خيارات">${Icon('menu', 20)}</button>
      </div>`;
    }

    function render() {
      renderBanner();
      const panel = node.querySelector('[data-panel]');
      clearInterval(clock);

      if (t.status === 'DRIVER_ARRIVING' || t.status === 'DRIVER_ACCEPTED') {
        const d = lastPos ? Math.round(CapKit.distance(lastPos, t.pickup)) : null;
        const near = d !== null && d <= NEAR_M;
        panel.innerHTML = `
          <div class="sheet__grip"></div>
          ${custRow()}
          <div class="sm muted" style="margin:var(--s-4) 0 var(--s-2)">${esc(t.pickup.address || '')}</div>
          ${near ? `<div class="near-hint">${Icon('checkCircle', 18)} أنت عند الزبون</div>` : ''}
          <button class="btn ${near ? 'btn--accept' : 'btn--primary'}" style="min-height:58px;font-size:18px" data-arrived>وصلت</button>`;
        panel.querySelector('[data-arrived]').onclick = async (e) => {
          const btn = e.currentTarget; busy(btn, true, 'لحظة');
          CapKit.Location.sendNow();
          try { t = (await API.cap.arrived(t.id)).trip; toast('بلّغنا الزبون إنك وصلت', 'success'); render(); drawTarget(); }
          catch (err) { toast(err.message, 'error'); busy(btn, false); }
        };
      } else if (t.status === 'DRIVER_ARRIVED') {
        panel.innerHTML = `
          <div class="sheet__grip"></div>
          ${custRow()}
          <div class="wait" data-wait><span data-wait-label>انتظار مجاني</span><b data-wait-time>—</b></div>
          <div data-swipe></div>
          <button class="btn btn--ghost hidden" style="margin-top:var(--s-3)" data-noshow>الزبون ما إجا</button>`;
        panel.querySelector('[data-swipe]').replaceWith(CapKit.swipe('اسحب لبدء الرحلة', async () => {
          try { t = (await API.cap.start(t.id)).trip; render(); drawTarget(); }
          catch (err) { toast(err.message, 'error'); }
        }));
        const tickWait = () => {
          const waited = (Date.now() - Date.parse(t.arrivedAt)) / 1000;
          const free = t.freeWaitingSec - waited;
          const box = panel.querySelector('[data-wait]');
          if (!box) return;
          if (free > 0) {
            box.classList.remove('wait--paid');
            panel.querySelector('[data-wait-label]').textContent = 'انتظار مجاني — متبقي';
            panel.querySelector('[data-wait-time]').textContent = CapKit.mmss(free);
          } else {
            const paidMin = Math.floor(-free / 60);
            box.classList.add('wait--paid');
            panel.querySelector('[data-wait-label]').textContent =
              t.waitingPerMinFils ? `انتظار مدفوع · +${CapKit.jod(paidMin * t.waitingPerMinFils)} د.أ` : 'انتهى الانتظار المجاني';
            panel.querySelector('[data-wait-time]').textContent = CapKit.mmss(-free);
            panel.querySelector('[data-noshow]').classList.remove('hidden');
          }
        };
        tickWait(); clock = setInterval(tickWait, 1000);
        panel.querySelector('[data-noshow]').onclick = noShow;
      } else if (t.status === 'TRIP_STARTED') {
        panel.innerHTML = `
          <div class="sheet__grip"></div>
          ${custRow()}
          <div class="breakdown" style="margin:var(--s-4) 0">
            <div class="breakdown__row"><span class="muted">الأجرة المتفق عليها</span><b>${esc(t.estFareText)} د.أ</b></div>
            <div class="breakdown__row"><span class="muted">المسافة المتوقعة</span><b>${esc(t.estDistanceKm)} كم</b></div>
          </div>
          <div data-swipe></div>`;
        panel.querySelector('[data-swipe]').replaceWith(CapKit.swipe('اسحب لإنهاء الرحلة', async () => {
          CapKit.Location.sendNow();
          try { const r = await API.cap.complete(t.id); leave(); show(S.summary(r.trip)); }
          catch (err) { toast(err.message, 'error'); }
        }, { tone: 'green' }));
      }
      const more = panel.querySelector('[data-more]');
      if (more) more.onclick = moreMenu;
    }

    /* ----------------------------- الإلغاء ----------------------------- */
    function moreMenu() {
      if (t.status === 'TRIP_STARTED') {
        const s = UI.sheet(`
          <h2 class="h2" style="margin-bottom:var(--s-2)">مشكلة بالرحلة؟</h2>
          <p class="muted sm" style="margin:0 0 var(--s-4)">بعد بدء الرحلة ما بينفع الإلغاء من التطبيق. للطوارئ اتصل بالجهات المختصة مباشرة.</p>
          <button class="btn btn--ghost" data-close>تمام</button>`);
        s.node.querySelector('[data-close]').onclick = s.close;
        return;
      }
      const reasons = ['عطل بالسيارة', 'الزبون طلب مني ألغي', 'ما بقدر أوصل للمكان', 'سبب ثاني'];
      const s = UI.sheet(`
        <h2 class="h2" style="margin-bottom:var(--s-2)">إلغاء الرحلة؟</h2>
        <p class="muted sm" style="margin:0 0 var(--s-4)">بنرجّع الطلب للبحث عن كابتن ثاني فوراً حتى ما يتعطل الزبون. الإلغاء بينحسب بنسبة إلغاءاتك.</p>
        <div class="reason-list">${reasons.map((r) => `<button data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
        <button class="btn btn--danger" data-go disabled>إلغاء الرحلة</button>
        <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-close>تراجع</button>`);
      let reason = null;
      s.node.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => {
        s.node.querySelectorAll('[data-r]').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        reason = b.dataset.r; s.node.querySelector('[data-go]').disabled = false;
      });
      s.node.querySelector('[data-close]').onclick = s.close;
      s.node.querySelector('[data-go]').onclick = async (e) => {
        busy(e.currentTarget, true);
        try { const r = await API.cap.cancel(t.id, { reason }); s.close(); toast(r.message); leave(); App.go('home'); }
        catch (err) { toast(err.message, 'error'); busy(e.currentTarget, false); }
      };
    }

    async function noShow() {
      const yes = await UI.confirm({
        title: 'الزبون ما إجا؟', body: 'بنسجّل إن الزبون ما حضر وبتنتهي الرحلة. تأكد إنك اتصلت فيه أولاً.',
        confirmText: 'تسجيل عدم الحضور', danger: true,
      });
      if (!yes) return;
      try { const r = await API.cap.cancel(t.id, { noShow: true }); toast(r.message); leave(); App.go('home'); }
      catch (err) { toast(err.message, 'error'); }
    }

    /* ------------------------ متابعة حالة الرحلة من الخادم ------------------------ */
    async function refresh() {
      try {
        const r = await API.cap.trip(t.id);
        const prev = t.status;
        if (r.trip.isFinal || r.trip.status === 'REASSIGNED') {
          leave();
          const msg = r.trip.status === 'CANCELLED_BY_CUSTOMER' ? 'الزبون ألغى الرحلة' : (r.trip.statusLabel || 'انتهت الرحلة');
          await UI.confirm({ title: msg, body: 'رجعناك لاستقبال الطلبات.', confirmText: 'تمام', cancelText: 'إغلاق' });
          App.go('home');
          return;
        }
        t = r.trip;
        if (t.status !== prev) { render(); drawTarget(); }
      } catch (err) {
        if (err.code === 'NOT_FOUND') { leave(); App.go('home'); }
      }
    }
    poll = setInterval(refresh, 3000);

    function leave() { clearInterval(poll); clearInterval(clock); unsubscribe(); }
    UI.onLeave(node, leave);

    render();
    return node;
  };

  /* ============================ ملخص الرحلة والتحصيل ============================ */
  S.summary = function (t) {
    const f = t.final || {};
    const node = el(`
      <section class="screen screen--scroll">
        <div class="pad" style="padding-top:calc(var(--safe-t) + var(--s-6))">
          <div class="collect">
            <div class="collect__label">اقبض من الزبون كاش</div>
            <div class="collect__amount">${esc(f.grossText || t.estFareText)}</div>
            <div class="collect__label">دينار أردني</div>
          </div>
          <div class="breakdown">
            <div class="breakdown__row"><span class="muted">الرحلة</span><b>${esc(f.distanceKm || '')} كم · ${f.durationMin || ''} د</b></div>
            ${f.waitingFeeText && f.waitingFeeText !== '0.000' ? `<div class="breakdown__row"><span class="muted">منها رسوم انتظار</span><b>${esc(f.waitingFeeText)}</b></div>` : ''}
            <div class="breakdown__row"><span class="muted">عمولة نشمي (تُخصم من محفظتك)</span><b>-${esc(f.commissionText || '')}</b></div>
            <div class="breakdown__row breakdown__row--total"><span>صافي ربحك</span><b>${esc(f.earningsText || '')} د.أ</b></div>
          </div>
          <hr class="divider">
          <h2 class="h3" style="text-align:center;margin-bottom:var(--s-4)">قيّم الزبون ${esc((t.customer && t.customer.firstName) || '')}</h2>
          <div class="stars" data-stars>
            ${[1, 2, 3, 4, 5].map((i) => `<button data-s="${i}" aria-label="${i} نجوم">${Icon('star', 38)}</button>`).join('')}
          </div>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-done>تم — رجّعني للطلبات</button>
        </div>
      </section>`);
    let stars = 0;
    node.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
      stars = Number(b.dataset.s);
      node.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', Number(x.dataset.s) <= stars));
    });
    node.querySelector('[data-done]').onclick = async (e) => {
      busy(e.currentTarget, true);
      if (stars) await API.cap.rate(t.id, stars).catch(() => {});
      await App.go('home');
    };
    return node;
  };
})();
