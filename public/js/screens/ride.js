/* خيارات الرحلة والسعر → البحث عن كابتن → متابعة الرحلة → التقييم */
window.Screens = window.Screens || {};

(function () {
  const { el, esc, show, toast, busy } = UI;

  /* --------------------------- خيارات الرحلة --------------------------- */
  Screens.rideOptions = function rideOptionsScreen() {
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="roMap"></div></div>
        <div class="topbar topbar--floating">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
        </div>

        <div class="sheet">
          <div class="sheet__grip"></div>
          <div class="route-line" style="margin-bottom:var(--s-4)">
            <div class="route-line__rail">
              <span class="route-line__dot"></span><span class="route-line__bar"></span>
              <span class="route-line__dot route-line__dot--end"></span>
            </div>
            <div class="route-line__labels">
              <div class="sm"><div class="muted-3 xs">من</div>
                <div class="bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(App.pickup.label || 'موقعي')}</div></div>
              <div class="sm"><div class="muted-3 xs">إلى</div>
                <div class="bold" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(App.destination.label || App.destination.address || '')}</div></div>
            </div>
          </div>

          <div class="row sm muted" data-meta style="justify-content:center;gap:var(--s-5);margin-bottom:var(--s-4)">
            <span class="skeleton" style="width:150px;height:18px"></span>
          </div>

          <div class="stack" style="gap:var(--s-2)" data-options>
            <div class="skeleton" style="height:72px"></div>
            <div class="skeleton" style="height:72px"></div>
          </div>

          <div class="row" style="margin:var(--s-4) 0;gap:var(--s-2)">
            <span class="chip">${Icon('wallet', 16)} كاش</span>
            <span class="muted-3 sm">الدفع نقداً للكابتن</span>
          </div>

          <button class="btn btn--primary" data-request disabled>اطلب الآن</button>
        </div>
      </section>`);

    node.querySelector('[data-back]').onclick = () => show(Screens.confirmPickup());

    let map, destMarker = null, destChip = '';
    const short = (t) => { t = String(t || ''); return t.length > 22 ? t.slice(0, 21) + '…' : t; };
    setTimeout(async () => {
      map = MapKit.create(node.querySelector('#roMap'), { center: App.pickup, zoom: 14 });
      L.marker([App.pickup.lat, App.pickup.lng], { icon: MapKit.pickupIcon(short(App.pickup.label)), interactive: false }).addTo(map);
      destMarker = L.marker([App.destination.lat, App.destination.lng], { icon: MapKit.destIcon(destChip), interactive: false }).addTo(map);
      MapKit.frame(map, [App.pickup, App.destination], { sheet: MapKit.sheetHeight(node) });
      const r = await MapKit.route(map, App.pickup, App.destination);
      MapKit.frame(map, r.bounds, { sheet: MapKit.sheetHeight(node), top: 110 });
    }, 30);

    const optionsBox = node.querySelector('[data-options]');
    const metaBox = node.querySelector('[data-meta]');
    const requestBtn = node.querySelector('[data-request]');
    let chosen = null;

    (async () => {
      try {
        const est = await API.estimate({
          pickupLat: App.pickup.lat, pickupLng: App.pickup.lng,
          destLat: App.destination.lat, destLng: App.destination.lng,
        });
        metaBox.innerHTML = `
          <span class="row" style="gap:6px">${Icon('navigate', 16)} <span class="num">${esc(est.distanceText)}</span> كم</span>
          <span class="row" style="gap:6px">${Icon('clock', 16)} <span class="num">${esc(est.durationText)}</span> دقيقة</span>`;
        optionsBox.innerHTML = est.options.map((o, i) => `
          <button class="opt ${i === 0 ? 'on' : ''}" data-i="${i}">
            <span class="opt__icon">${Icon(o.icon, 34)}</span>
            <span class="grow" style="min-width:0">
              <span class="bold" style="display:block">${esc(o.nameAr)}</span>
              <span class="sm muted-3" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.descAr || '')}</span>
            </span>
            <span class="opt__price">${esc(o.fareText)} <span class="xs muted">د.أ</span></span>
          </button>`).join('');
        chosen = est.options[0];
        requestBtn.disabled = false;
        // بطاقة الوجهة تعرض مدة الرحلة — مثل أوبر
        destChip = `${est.durationText} د`;
        if (destMarker) destMarker.setIcon(MapKit.destIcon(destChip));
        optionsBox.querySelectorAll('[data-i]').forEach((b) => {
          b.onclick = () => {
            optionsBox.querySelectorAll('.opt').forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            chosen = est.options[Number(b.dataset.i)];
          };
        });
      } catch (e) {
        optionsBox.innerHTML = `<div class="card" style="background:var(--danger-100);border-color:transparent">
          <div class="row" style="align-items:flex-start;color:var(--danger-500)">${Icon('alert', 20)}
          <span class="sm bold">${esc(e.message)}</span></div></div>`;
        metaBox.innerHTML = '';
      }
    })();

    requestBtn.onclick = async () => {
      if (!chosen) return;
      busy(requestBtn, true, 'جاري إرسال الطلب');
      try {
        const res = await API.createTrip({
          pickupLat: App.pickup.lat, pickupLng: App.pickup.lng, pickupAddress: App.pickup.label || App.pickup.address,
          destLat: App.destination.lat, destLng: App.destination.lng,
          destAddress: App.destination.label || App.destination.address,
          vehicleTypeId: chosen.vehicleTypeId, paymentMethod: 'CASH',
        });
        show(Screens.tripLive(res.trip));
      } catch (e) {
        toast(e.message, 'error');
        busy(requestBtn, false);
      }
    };

    return node;
  };

  /* ---------------------- متابعة الرحلة (حالة حية) ---------------------- */
  Screens.tripLive = function tripLiveScreen(trip) {
    const node = el(`
      <section class="screen">
        <div class="map-wrap"><div class="map" id="tlMap"></div></div>
        <div class="topbar topbar--floating">
          <button class="icon-btn" data-back aria-label="الرئيسية">${Icon('back', 22)}</button>
        </div>
        <div class="sheet" data-panel></div>
      </section>`);

    let map, captainMarker = null, searchPulse = null, poll = null, current = trip;

    node.querySelector('[data-back]').onclick = () => { stop(); App.go('home'); };
    const stop = () => { if (poll) clearInterval(poll); poll = null; };
    UI.onLeave(node, stop);

    setTimeout(async () => {
      map = MapKit.create(node.querySelector('#tlMap'), { center: current.pickup, zoom: 15 });
      L.marker([current.pickup.lat, current.pickup.lng], { icon: MapKit.pickupIcon(), interactive: false }).addTo(map);
      L.marker([current.destination.lat, current.destination.lng], { icon: MapKit.destIcon(), interactive: false }).addTo(map);
      syncSearchPulse();
      placeCaptain();
      MapKit.frame(map, framePoints(), { sheet: MapKit.sheetHeight(node) });
      const r = await MapKit.route(map, current.pickup, current.destination);
      const b = r.bounds;
      const loc = current.captain && current.captain.location;
      if (loc) b.extend([loc.lat, loc.lng]);
      MapKit.frame(map, b, { sheet: MapKit.sheetHeight(node), top: 110 });
    }, 30);

    /** الإطار يشمل سيارة الكابتن إن وُجدت حتى يراها العميل */
    function framePoints() {
      const pts = [current.pickup, current.destination];
      const loc = current.captain && current.captain.location;
      if (loc) pts.push(loc);
      return pts;
    }

    /** حلقات بحث نابضة حول نقطة الانطلاق أثناء البحث عن كابتن */
    function syncSearchPulse() {
      if (!map) return;
      const searching = current.status === 'SEARCHING' || current.status === 'REQUESTED';
      if (searching && !searchPulse) {
        searchPulse = L.marker([current.pickup.lat, current.pickup.lng], {
          icon: L.divIcon({ className: 'mk', html: '<div class="mk-search"><i></i><i></i><i></i></div>', iconSize: [0, 0] }),
          interactive: false, zIndexOffset: -100,
        }).addTo(map);
      } else if (!searching && searchPulse) { searchPulse.remove(); searchPulse = null; }
    }

    /** سيارة الكابتن الحقيقية — تتحرك بنعومة وتدور حسب اتجاهها */
    function placeCaptain() {
      const loc = current.captain && current.captain.location;
      if (!map) return;
      if (!loc) { if (captainMarker) { captainMarker.remove(); captainMarker = null; } return; }
      if (captainMarker) captainMarker.glideTo(loc, loc.heading);
      else captainMarker = MapKit.carMarker(map, loc, loc.heading);
    }

    render(current);
    poll = setInterval(refresh, 3000);

    async function refresh() {
      try {
        const res = await API.trip(current.id);
        const prev = current.status;
        current = res.trip;
        placeCaptain();
        syncSearchPulse();
        const captainStates = ['DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'];
        if (captainStates.includes(prev) && current.status === 'SEARCHING') {
          toast('الكابتن اعتذر — نبحث لك عن كابتن ثاني الآن');
        }
        if (prev !== 'DRIVER_ARRIVED' && current.status === 'DRIVER_ARRIVED' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
        if (current.status !== prev) render(current);
        else updateTimer();
        if (current.isFinal) {
          stop();
          if (current.status === 'TRIP_COMPLETED') show(Screens.rateTrip(current));
          else render(current);
        }
      } catch (e) {
        if (e.code === 'NETWORK') return; // نعيد المحاولة بالنبضة التالية
        stop(); toast(e.message, 'error');
      }
    }

    function updateTimer() {
      const t = node.querySelector('[data-elapsed]');
      if (t) t.textContent = String(Math.max(0, current.searchElapsedSec + 0));
    }

    function render(t) {
      const panel = node.querySelector('[data-panel]');
      if (t.status === 'SEARCHING' || t.status === 'REQUESTED') {
        panel.innerHTML = `
          <div class="sheet__grip"></div>
          <div class="radar" style="margin-block:var(--s-2) var(--s-5)">
            <span class="radar__ring"></span><span class="radar__ring"></span><span class="radar__ring"></span>
            <span class="radar__core">${Icon('car', 34)}</span>
          </div>
          <h2 class="h2" style="text-align:center">جاري البحث عن كابتن…</h2>
          <p class="muted sm" style="text-align:center;margin:var(--s-2) 0 var(--s-5)">
            نبحث عن أقرب كابتن لك · مضى <span class="num" data-elapsed>${t.searchElapsedSec}</span> ثانية
          </p>
          <button class="btn btn--ghost" data-cancel>إلغاء الطلب</button>`;
        wireCancel(panel);
        return;
      }

      if (t.status === 'NO_DRIVER_FOUND') {
        panel.innerHTML = `
          <div class="sheet__grip"></div>
          <div class="center" style="margin-block:var(--s-4)">
            <span style="color:var(--warning-500)">${Icon('alert', 44)}</span>
          </div>
          <h2 class="h2" style="text-align:center">ما في كابتن متاح حالياً</h2>
          <p class="muted sm" style="text-align:center;margin:var(--s-2) 0 var(--s-5)">
            ما حدا من الكباتن كان متصلاً قريباً منك. جرّب بعد شوي.
          </p>
          <button class="btn btn--primary" data-retry>حاول مرة ثانية</button>
          <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-home>الرجوع للرئيسية</button>`;
        panel.querySelector('[data-retry]').onclick = () => show(Screens.rideOptions());
        panel.querySelector('[data-home]').onclick = () => App.go('home');
        return;
      }

      if (t.isFinal) {
        panel.innerHTML = `
          <div class="sheet__grip"></div>
          <div class="center" style="margin-block:var(--s-4)">${Icon('close', 40)}</div>
          <h2 class="h2" style="text-align:center">${esc(t.statusLabel)}</h2>
          ${t.cancellationFeeFils > 0
            ? `<p class="sm" style="text-align:center;color:var(--danger-500);margin-top:var(--s-2)">
                 رسوم الإلغاء: <span class="num">${esc(t.cancellationFeeText)}</span> د.أ</p>`
            : '<p class="muted sm" style="text-align:center;margin-top:var(--s-2)">بدون رسوم</p>'}
          <button class="btn btn--primary" style="margin-top:var(--s-5)" data-home>الرجوع للرئيسية</button>`;
        panel.querySelector('[data-home]').onclick = () => App.go('home');
        return;
      }

      // كابتن مُسند: الرحلة جارية
      const c = t.captain || {};
      panel.innerHTML = `
        <div class="sheet__grip"></div>
        <div class="row" style="margin-bottom:var(--s-4)">
          <span class="chip chip--brand">${esc(t.statusLabel)}</span>
          <div class="spacer"></div>
          <span class="sm muted-3 num">${esc(t.code)}</span>
        </div>
        <div class="row" style="margin-bottom:var(--s-4)">
          ${UI.avatar({ name: c.name, photoUrl: c.photoUrl }, 'avatar--md')}
          <div class="grow" style="min-width:0">
            <div class="bold">${esc(c.name || 'الكابتن')}</div>
            <div class="sm muted-3">
              ${c.rating ? `<span class="num">${c.rating}</span> ★ · ` : ''}
              ${c.vehicle ? esc([c.vehicle.color, c.vehicle.make, c.vehicle.model].filter(Boolean).join(' ')) : ''}
            </div>
          </div>
          ${c.vehicle ? `<span class="chip num">${esc(c.vehicle.plate)}</span>` : ''}
        </div>
        ${t.status === 'DRIVER_ARRIVED' ? `<div class="card" style="background:var(--success-100);border-color:transparent;margin-bottom:var(--s-4);padding:var(--s-3) var(--s-4)">
          <div class="row sm bold" style="color:var(--success-500)">${Icon('checkCircle', 18)} الكابتن وصل وبانتظارك — اطلع لعنده</div></div>` : ''}
        <div class="row" style="gap:var(--s-2);margin-bottom:var(--s-4)">
          ${c.phone ? `<a class="btn btn--ghost" href="tel:${esc(c.phone)}">${Icon('phone', 18)} اتصال</a>` : ''}
          <button class="btn btn--ghost" data-share>${Icon('share', 18)} شارك الرحلة</button>
        </div>
        <div class="row sm muted" style="justify-content:space-between;padding-block:var(--s-3);border-top:1px solid var(--border)">
          <span>الأجرة المتوقعة</span>
          <span class="bold" style="color:var(--text)"><span class="num">${esc(t.fareText)}</span> د.أ · كاش</span>
        </div>
        ${t.status !== 'TRIP_STARTED' ? '<button class="btn btn--danger" data-cancel>إلغاء الرحلة</button>' : ''}`;
      wireCancel(panel);
      const shareBtn = panel.querySelector('[data-share]');
      if (shareBtn) shareBtn.onclick = async () => {
        const text = `أنا برحلة نشمي ${t.code}. الكابتن ${c.name || ''}${c.vehicle ? ' - ' + c.vehicle.plate : ''}`;
        if (navigator.share) { try { await navigator.share({ title: 'رحلتي مع نشمي', text }); } catch {} }
        else { try { await navigator.clipboard.writeText(text); toast('تم نسخ تفاصيل الرحلة', 'success'); } catch { toast('تعذّرت المشاركة'); } }
      };
    }

    function wireCancel(panel) {
      const btn = panel.querySelector('[data-cancel]');
      if (!btn) return;
      btn.onclick = async () => {
        let feeText = '0.000';
        try { feeText = (await API.cancelPreview(current.id)).feeText; } catch {}
        const yes = await UI.confirm({
          title: 'إلغاء الرحلة؟',
          body: feeText !== '0.000' ? `سيتم احتساب رسوم إلغاء ${feeText} د.أ` : 'لن يتم احتساب أي رسوم',
          confirmText: 'نعم، ألغِ', cancelText: 'تراجع', danger: true,
        });
        if (!yes) return;
        busy(btn, true, 'جاري الإلغاء');
        try {
          const res = await API.cancelTrip(current.id, 'إلغاء من العميل');
          toast(res.message, res.feeFils > 0 ? '' : 'success');
          stop();
          App.go('home');
        } catch (e) { toast(e.message, 'error'); busy(btn, false); }
      };
    }

    return node;
  };

  /* ------------------------------ التقييم ------------------------------ */
  Screens.rateTrip = function rateTripScreen(trip) {
    const TAGS = ['قيادة آمنة', 'سيارة نظيفة', 'وصل بسرعة', 'أخلاق عالية', 'طريق مناسب'];
    const node = el(`
      <section class="screen screen--scroll">
        <div class="pad" style="padding-top:calc(var(--safe-t) + var(--s-8));text-align:center">
          <div class="center" style="width:74px;height:74px;border-radius:var(--r-pill);background:var(--success-100);color:var(--success-500);margin:0 auto var(--s-5)">
            ${Icon('check', 36)}
          </div>
          <h1 class="h1">تم الوصول بنجاح</h1>
          <p class="muted" style="margin-top:var(--s-2)">شكراً لاستخدامك نشمي</p>

          <div class="fare" style="margin:var(--s-6) 0 var(--s-2)">
            <span class="fare__value">${esc(trip.fareText)}</span><span class="fare__cur">د.أ</span>
          </div>
          <p class="sm muted-3">
            <span class="num">${esc(trip.distanceKm)}</span> كم ·
            <span class="num">${trip.durationMin}</span> دقيقة · كاش
          </p>

          <hr class="divider">
          <h2 class="h3" style="margin-bottom:var(--s-4)">كيف كانت رحلتك؟</h2>
          <div class="stars" data-stars>
            ${[1, 2, 3, 4, 5].map((i) => `<button data-s="${i}" aria-label="${i} نجوم">${Icon('star', 38)}</button>`).join('')}
          </div>
          <div class="row hidden" data-tags style="flex-wrap:wrap;gap:var(--s-2);justify-content:center;margin-top:var(--s-5)">
            ${TAGS.map((t) => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-send disabled>أرسل التقييم</button>
          <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-skip>لاحقاً</button>
        </div>
      </section>`);

    let stars = 0;
    const picked = new Set();
    const sendBtn = node.querySelector('[data-send]');

    node.querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = () => {
        stars = Number(b.dataset.s);
        node.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', Number(x.dataset.s) <= stars));
        node.querySelector('[data-tags]').classList.remove('hidden');
        sendBtn.disabled = false;
      };
    });
    node.querySelectorAll('[data-tag]').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.tag;
        if (picked.has(t)) { picked.delete(t); b.classList.remove('chip--brand'); }
        else { picked.add(t); b.classList.add('chip--brand'); }
      };
    });

    node.querySelector('[data-skip]').onclick = () => App.go('home');
    sendBtn.onclick = async () => {
      busy(sendBtn, true, 'جاري الإرسال');
      try {
        await API.rateTrip(trip.id, { stars, tags: [...picked] });
        toast('شكراً لتقييمك', 'success');
      } catch (e) { toast(e.message, 'error'); }
      App.go('home');
    };

    return node;
  };
})();
