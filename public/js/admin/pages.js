/* ==========================================================
   لوحة الإدارة — الصفحات: القيادة، الخريطة الحية، الرحلات، الكباتن، الشحن،
   العملاء، الأسعار، الإعدادات، المشرفون، سجل العمليات.
   ========================================================== */
(function () {
  const { el, esc, toast } = UI;
  const A = window.Admin;
  const P = A.Pages;
  const api = (p) => '/api/admin' + p;

  /* ------------------------------ أدوات مشتركة ------------------------------ */
  const TRIP_LABEL = {
    REQUESTED: 'طلب جديد', SEARCHING: 'يبحث عن كابتن', DRIVER_ASSIGNED: 'تم الإسناد', DRIVER_ACCEPTED: 'الكابتن قبل',
    DRIVER_ARRIVING: 'الكابتن بالطريق', DRIVER_ARRIVED: 'الكابتن وصل', TRIP_STARTED: 'الرحلة جارية', TRIP_COMPLETED: 'مكتملة',
    CANCELLED_BY_CUSTOMER: 'ألغاها العميل', CANCELLED_BY_DRIVER: 'ألغاها الكابتن', CANCELLED_BY_SYSTEM: 'ألغتها الإدارة/النظام',
    NO_DRIVER_FOUND: 'ما لقى كابتن',
  };
  const tripPill = (s) => A.pill(s, TRIP_LABEL[s] || s);
  const DOC_LABEL = { license: 'رخصة القيادة', id: 'الهوية الشخصية', registration: 'رخصة المركبة' };
  const TX_LABEL = { COMMISSION: 'عمولة رحلة', DEPOSIT: 'شحن رصيد', ADJUSTMENT: 'تعديل', BONUS: 'مكافأة', CORRECTION: 'تصحيح', REFUND: 'استرجاع' };
  const RISK = { NORMAL: ['', 'عادي'], WATCH: ['warn', 'مراقبة'], HIGH: ['bad', 'مرتفع'] };
  const riskPill = (r) => { const x = RISK[r] || RISK.NORMAL; return `<span class="pill ${x[0] ? 'pill--' + x[0] : ''}">${x[1]}</span>`; };

  function render(main, html) {
    main.innerHTML = '';
    const node = el(`<div class="page">${html}</div>`);
    main.appendChild(node);
    return node;
  }
  const head = (title, sub = '', right = '') => `
    <div class="page__head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="spacer"></div>${right}</div>`;
  const crumb = (href, label) => `<a class="crumb" href="${href}">${Icon('forward', 16)}<span>${esc(label)}</span></a>`;
  const money = (fils) => `${A.jod(fils)} <small>د.أ</small>`;
  const rowEmpty = (cols, text = 'ما في بيانات') => `<tr><td class="empty-row" colspan="${cols}">${esc(text)}</td></tr>`;
  const openTrip = (tbody) => { tbody.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/trips/' + tr.dataset.id; }; };

  /** تنفيذ إجراء مع قفل الزر وإظهار الخطأ */
  async function act(btn, fn, okText) {
    if (btn) UI.busy(btn, true);
    try { const r = await fn(); if (okText) toast(okText, 'success'); return r || true; }
    catch (e) { toast(e.message || 'صار خطأ', 'error'); return false; }
    finally { if (btn && btn.isConnected) UI.busy(btn, false); }
  }

  /** تبويبات فلترة */
  function tabs(host, items, value, onChange) {
    host.innerHTML = items.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${esc(l)}</button>`).join('');
    host.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      host.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.v);
    };
  }

  /** قائمة مع بحث وتبويبات و«عرض المزيد» */
  function listPage(node, { url, key, filters, initial = '', cols, row, onRow, searchPh }) {
    const st = { status: initial, q: '', page: 0 };
    const tbody = node.querySelector('tbody');
    const more = node.querySelector('[data-more]');
    let seq = 0;
    async function load(append) {
      const my = ++seq;
      const qs = new URLSearchParams({ page: st.page });
      if (st.status) qs.set('status', st.status);
      if (st.q) qs.set('q', st.q);
      if (!append) tbody.innerHTML = `<tr><td colspan="${cols}"><div class="skeleton" style="height:40px"></div></td></tr>`;
      try {
        const d = await API.get(api(url) + '?' + qs);
        if (my !== seq) return;
        const html = d[key].map(row).join('');
        if (append) tbody.insertAdjacentHTML('beforeend', html);
        else tbody.innerHTML = html || rowEmpty(cols, 'ما في نتائج');
        more.classList.toggle('hidden', !d.hasMore);
      } catch (e) { if (my === seq) tbody.innerHTML = rowEmpty(cols, e.message); }
    }
    if (filters) tabs(node.querySelector('[data-tabs]'), filters, initial, (v) => { st.status = v; st.page = 0; load(); });
    const search = node.querySelector('[data-search]');
    if (search) {
      search.placeholder = searchPh || 'بحث';
      let t; search.oninput = () => { clearTimeout(t); t = setTimeout(() => { st.q = search.value.trim(); st.page = 0; load(); }, 300); };
    }
    more.querySelector('button').onclick = () => { st.page++; load(true); };
    tbody.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      const tr = e.target.closest('tr[data-id]'); if (tr && onRow) onRow(tr.dataset.id);
    });
    load();
    return { reload: () => { st.page = 0; load(); } };
  }
  const listShell = (headHtml, withTabs, withSearch, ths) => `
    ${headHtml}
    ${withTabs || withSearch ? `<div class="toolbar">${withTabs ? '<div class="tabs" data-tabs></div>' : ''}${withSearch ? '<input class="search" data-search type="search">' : ''}</div>` : ''}
    <div class="panel panel--flush"><div class="table-wrap"><table class="t">
      <thead><tr>${ths.map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <div class="more hidden" data-more><button class="btn btn--ghost">عرض المزيد</button></div></div>`;

  const TRIP_TH = '<thead><tr><th>الرحلة</th><th>العميل</th><th>الكابتن</th><th>المسار</th><th>الحالة</th><th>الأجرة</th></tr></thead>';
  const tripRowHtml = (t) => `
    <tr class="link" data-id="${t.id}">
      <td><b class="num">${esc(t.code)}</b><div class="muted-cell">${esc(A.when(t.requestedAt))}</div></td>
      <td>${esc(t.customerName || '—')}${t.customerPhone ? `<div class="muted-cell" style="direction:ltr;text-align:end">${esc(t.customerPhone)}</div>` : ''}</td>
      <td>${esc(t.captainName || '—')}</td>
      <td class="clip" title="${esc(t.pickupAddress || '')} ← ${esc(t.destAddress || '')}">${esc(t.pickupAddress || '')} ← ${esc(t.destAddress || '')}</td>
      <td>${tripPill(t.status)}</td>
      <td class="num">${esc(t.fareText)}</td>
    </tr>`;

  function newMap(node, opts) {
    const map = MapKit.create(node, { zoom: 12, ...opts });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    setTimeout(() => { if (!map._gone) map.invalidateSize(); }, 60);
    A.onLeave(() => { map._gone = true; try { map.stop(); map.remove(); } catch {} });
    return map;
  }
  /** ضبط الإطار بدون حركة (أثبت مع التحديث الدوري) */
  function fit(map, pts, maxZoom = 15) {
    if (map._gone || !pts.length) return;
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [50, 50], maxZoom });
  }

  /** طبقة الكباتن والطلبات على أي خريطة */
  function liveLayer(map, onData) {
    const cars = new Map(), pins = new Map();
    let framed = false;
    async function refresh() {
      let d; try { d = await API.get(api('/live')); } catch { return; }
      if (map._gone) return;
      const seen = new Set();
      for (const c of d.captains) {
        seen.add(c.id);
        const tip = `${c.name || 'كابتن'}${c.plate ? ' · ' + c.plate : ''} — ${c.busy ? 'برحلة' : 'متاح'}`;
        let m = cars.get(c.id);
        if (!m) { m = MapKit.carMarker(map, c, c.heading); m.bindTooltip('', { direction: 'top' }); cars.set(c.id, m); }
        else m.glideTo(c, c.heading);
        m.setTooltipContent(esc(tip));
        const e = m.getElement(); if (e) e.style.opacity = c.busy ? '.5' : '1';
      }
      for (const [id, m] of cars) if (!seen.has(id)) { m.remove(); cars.delete(id); }
      const seenT = new Set();
      for (const t of d.trips) {
        seenT.add(t.id);
        if (!pins.has(t.id)) {
          const m = L.marker([t.pickup.lat, t.pickup.lng], { icon: MapKit.pickupIcon(t.code) }).addTo(map);
          m.on('click', () => { location.hash = '#/trips/' + t.id; });
          pins.set(t.id, m);
        }
      }
      for (const [id, m] of pins) if (!seenT.has(id)) { m.remove(); pins.delete(id); }
      const pts = [...d.captains, ...d.trips.map((t) => t.pickup)];
      if (!framed && pts.length) { framed = true; fit(map, pts, 14); }
      if (onData) onData(d);
    }
    return { refresh };
  }

  /* ================================ لوحة القيادة ================================ */
  P.dashboard = async (main) => {
    const d = await API.get(api('/dashboard'));
    const k = d.kpis;
    const tile = (label, value, sub = '') => `<div class="kpi"><div class="kpi__label">${label}</div><div class="kpi__value">${value}</div>${sub ? `<div class="kpi__sub">${sub}</div>` : ''}</div>`;
    const max = Math.max(1, ...d.days.map((x) => x.trips));
    const dayName = (key) => new Date(key + 'T12:00:00Z').toLocaleDateString('ar-JO', { weekday: 'short', timeZone: 'Asia/Amman' });
    const alerts = [
      k.pendingCaptains ? `<a class="alert" href="#/captains">${Icon('user', 18)}<span>كباتن بانتظار موافقتك</span><b class="num">${k.pendingCaptains}</b></a>` : '',
      k.pendingDeposits ? `<a class="alert" href="#/deposits">${Icon('wallet', 18)}<span>طلبات شحن بانتظار المراجعة</span><b class="num">${k.pendingDeposits}</b></a>` : '',
      k.searchingNow ? `<a class="alert" href="#/live">${Icon('navigate', 18)}<span>رحلات تبحث عن كابتن الآن</span><b class="num">${k.searchingNow}</b></a>` : '',
    ].join('');
    const node = render(main, `
      ${head('لوحة القيادة', 'أرقام اليوم بتوقيت عمّان — الخريطة بتتحدث تلقائياً')}
      ${alerts ? `<div class="alerts">${alerts}</div>` : ''}
      <div class="kpis">
        ${tile('رحلات مكتملة اليوم', k.completedToday)}
        ${tile('قيمة الرحلات اليوم', money(k.grossToday))}
        ${tile('عمولة نشمي اليوم', money(k.commissionToday))}
        ${tile('رحلات جارية الآن', k.activeNow, `${k.searchingNow} تبحث عن كابتن`)}
        ${tile('كباتن متصلين الآن', k.onlineCaptains, `من ${k.approvedCaptains} كابتن معتمد`)}
        ${tile('العملاء', k.customers, `${k.newCustomersToday} جديد اليوم`)}
        ${tile('ملغاة اليوم', k.cancelledToday, `${k.noDriverToday} ما لقت كابتن`)}
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel__title"><h2>الرحلات المكتملة — آخر 7 أيام</h2></div>
          <div class="bars" role="list">
            <div class="bars__grid"></div>
            ${d.days.map((x) => `
              <div class="bar" role="listitem" tabindex="0" aria-label="${esc(dayName(x.key))}: ${x.trips} رحلة، ${A.jod(x.grossFils)} دينار">
                <div class="bar__tip">${x.trips} رحلة · ${A.jod(x.grossFils)} د.أ · عمولة ${A.jod(x.commissionFils)}</div>
                <div class="bar__fill" style="height:calc((100% - 26px) * ${(x.trips / max).toFixed(3)})"></div>
                <div class="bar__day">${esc(dayName(x.key))}</div>
              </div>`).join('')}
          </div>
        </div>
        <div class="panel">
          <div class="panel__title"><h2>الآن على الخريطة</h2><div class="spacer"></div><a class="crumb" href="#/live">فتح الخريطة</a></div>
          <div class="live-map" data-map></div>
        </div>
      </div>
      <div class="panel panel--flush">
        <div class="panel__title"><h2>آخر الطلبات</h2><div class="spacer"></div><a class="crumb" href="#/trips">كل الرحلات</a></div>
        <div class="table-wrap"><table class="t">${TRIP_TH}
          <tbody>${d.recent.map(tripRowHtml).join('') || rowEmpty(6, 'ما في رحلات لسا')}</tbody></table></div>
      </div>`);
    openTrip(node.querySelector('tbody'));
    const live = liveLayer(newMap(node.querySelector('[data-map]')));
    live.refresh();
    A.every(10000, () => live.refresh());
  };

  /* ================================ الخريطة الحية ================================ */
  P.live = async (main) => {
    const node = render(main, `
      ${head('الخريطة الحية', 'الكباتن المتصلين والطلبات الجارية — تحديث كل 5 ثوانٍ. السيارة الباهتة = برحلة. اضغط على أي طلب لتفتحه.')}
      <div class="kpis" data-k></div>
      <div class="panel" style="padding:8px"><div class="live-map live-map--tall" data-map></div></div>`);
    const k = node.querySelector('[data-k]');
    const layer = liveLayer(newMap(node.querySelector('[data-map]')), (d) => {
      const busy = d.captains.filter((c) => c.busy).length;
      const searching = d.trips.filter((t) => ['REQUESTED', 'SEARCHING'].includes(t.status)).length;
      k.innerHTML = `
        <div class="kpi"><div class="kpi__label">كباتن متاحين</div><div class="kpi__value">${d.captains.length - busy}</div></div>
        <div class="kpi"><div class="kpi__label">كباتن برحلة</div><div class="kpi__value">${busy}</div></div>
        <div class="kpi"><div class="kpi__label">طلبات تبحث عن كابتن</div><div class="kpi__value">${searching}</div></div>
        <div class="kpi"><div class="kpi__label">رحلات جارية</div><div class="kpi__value">${d.trips.length - searching}</div></div>`;
    });
    await layer.refresh();
    A.every(5000, () => layer.refresh());
  };

  /* ================================== الرحلات ================================== */
  P.trips = async (main, id) => {
    if (id) return tripDetail(main, id);
    const node = render(main, listShell(head('الرحلات', 'اضغط على أي رحلة لتشوف تفاصيلها الكاملة'), true, true,
      ['الرحلة', 'العميل', 'الكابتن', 'المسار', 'الحالة', 'الأجرة']));
    listPage(node, {
      url: '/trips', key: 'trips', cols: 6, row: tripRowHtml, searchPh: 'رقم الرحلة، اسم أو رقم العميل أو الكابتن',
      filters: [['', 'الكل'], ['active', 'جارية'], ['completed', 'مكتملة'], ['cancelled', 'ملغاة']],
      onRow: (tid) => { location.hash = '#/trips/' + tid; },
    });
  };

  async function tripDetail(main, id) {
    const { trip: t } = await API.get(api('/trips/' + id));
    const m = t.money;
    const ACTOR = { customer: 'العميل', captain: 'الكابتن', system: 'النظام', admin: 'الإدارة' };
    const OFFER = { SENT: 'بانتظار الرد', ACCEPTED: 'قبل', REJECTED: 'رفض', EXPIRED: 'انتهت المهلة', SUPERSEDED: 'انسكّر' };
    const OFFER_PILL = { SENT: 'PENDING', ACCEPTED: 'APPROVED', REJECTED: 'REJECTED' };
    const moneyRow = (label, v) => `<dt>${label}</dt><dd class="num" style="text-align:end">${esc(v || '—')}</dd>`;
    const node = render(main, `
      ${crumb('#/trips', 'الرحلات')}
      ${head('رحلة ' + t.code, `${tripPill(t.status)} &nbsp; ${esc(A.when(t.requestedAt))}`,
        t.isActive && A.can('trips.manage') ? '<button class="btn btn--danger" data-cancel>إلغاء الرحلة</button>' : '')}
      <div class="grid-2">
        <div class="panel"><div class="panel__title"><h2>التفاصيل</h2></div>
          <dl class="dl">
            <dt>العميل</dt><dd>${t.customer ? `<a href="#/customers/${t.customer.id}">${esc(t.customer.name || 'بدون اسم')}</a> <span class="num">${esc(t.customer.phone)}</span>` : '—'}</dd>
            <dt>الكابتن</dt><dd>${t.captain ? `<a href="#/captains/${t.captain.id}">${esc(t.captain.name || 'بدون اسم')}</a> <span class="num">${esc(t.captain.phone)}</span><br><span class="muted sm">${esc(t.captain.car || '')} ${esc(t.captain.plate || '')}</span>` : '—'}</dd>
            <dt>من</dt><dd>${esc(t.pickup.address || '—')}</dd>
            <dt>إلى</dt><dd>${esc(t.destination.address || '—')}</dd>
            <dt>المسافة</dt><dd><span class="num">${t.distanceKm}</span> كم${Number(t.odometerKm) ? ` — عدّاد الكابتن <span class="num">${t.odometerKm}</span> كم` : ''}</dd>
            ${t.cancelReason ? `<dt>سبب الإلغاء</dt><dd>${esc(t.cancelReason)}</dd>` : ''}
          </dl>
          <div class="panel__title" style="margin-top:18px"><h2>المبالغ (دينار)</h2></div>
          <dl class="dl">
            ${moneyRow('الأجرة التقديرية', m.estText)}${moneyRow('الأجرة النهائية', m.grossText)}
            ${moneyRow('عمولة نشمي', m.commissionText)}${moneyRow('صافي الكابتن', m.earningsText)}
            ${moneyRow('رسوم الانتظار', m.waitingText)}${moneyRow('رسوم الإلغاء', m.cancelFeeText)}
          </dl>
        </div>
        <div class="panel" style="padding:8px"><div class="live-map" style="height:100%;min-height:340px" data-map></div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel__title"><h2>مراحل الرحلة</h2></div>
          <ol class="timeline">${t.history.map((h) => `<li><b>${esc(TRIP_LABEL[h.to] || h.label)}</b>
            <span>${esc(A.when(h.at))} · ${esc(ACTOR[h.actor] || h.actor || '')}${h.note ? ' · ' + esc(h.note) : ''}</span></li>`).join('') || '<li><span>لا يوجد</span></li>'}</ol>
        </div>
        <div class="panel panel--flush"><div class="panel__title"><h2>العروض اللي انبعتت للكباتن</h2></div>
          <div class="table-wrap"><table class="t"><thead><tr><th>الكابتن</th><th>الرد</th><th>كان يبعد</th><th>الوقت</th></tr></thead><tbody>
            ${t.offers.map((o) => `<tr><td>${esc(o.captain || '—')}</td><td>${A.pill(OFFER_PILL[o.status] || o.status, OFFER[o.status] || o.status)}</td>
              <td><span class="num">${o.distanceKm}</span> كم · <span class="num">${o.etaMin}</span> د</td><td class="muted-cell">${esc(A.when(o.sentAt))}</td></tr>`).join('') || rowEmpty(4, 'ما انبعتت عروض')}
          </tbody></table></div></div>
      </div>`);
    const map = newMap(node.querySelector('[data-map]'));
    const a = t.pickup, b = t.destination;
    L.marker([a.lat, a.lng], { icon: MapKit.pickupIcon('الانطلاق') }).addTo(map);
    L.marker([b.lat, b.lng], { icon: MapKit.destIcon('الوجهة') }).addTo(map);
    setTimeout(() => { if (map._gone) return; map.invalidateSize(); fit(map, [a, b]); }, 120);
    const cb = node.querySelector('[data-cancel]');
    if (cb) cb.onclick = async () => {
      const r = await A.ask({ title: 'إلغاء الرحلة ' + t.code, body: 'الرحلة رح تنلغى فوراً عند العميل والكابتن، بدون رسوم إلغاء.', confirmText: 'إلغاء الرحلة', danger: true });
      if (r && await act(cb, () => API.post(api(`/trips/${id}/cancel`), r), 'انلغت الرحلة')) A.route();
    };
  }

  /* ================================== الكباتن ================================== */
  const CAP_STATUS = { PENDING: 'بانتظار الموافقة', APPROVED: 'معتمد', REJECTED: 'مرفوض', SUSPENDED: 'موقوف مؤقتاً', BLOCKED: 'محظور' };

  P.captains = async (main, id) => {
    if (id) return captainDetail(main, id);
    const node = render(main, listShell(head('الكباتن', 'الطلبات الجديدة بتطلع أول القائمة. وافق مباشرة أو افتح الملف لتراجع الوثائق.'), true, true,
      ['الكابتن', 'المركبة', 'الحالة', 'الرصيد (د.أ)', 'رحلات', 'تقييم', 'وثائق', '']));
    const manage = A.can('captains.manage');
    const list = listPage(node, {
      url: '/captains', key: 'captains', cols: 8, searchPh: 'الاسم، الرقم أو رقم اللوحة',
      filters: [['', 'الكل'], ['PENDING', 'بانتظار الموافقة'], ['APPROVED', 'معتمدين'], ['SUSPENDED', 'موقوفين'], ['REJECTED', 'مرفوضين'], ['BLOCKED', 'محظورين']],
      onRow: (cid) => { location.hash = '#/captains/' + cid; },
      row: (c) => `
        <tr class="link" data-id="${c.id}">
          <td>${A.person(c.name, c.phone, c.photoUrl)}</td>
          <td>${esc(c.car || '—')}<div class="muted-cell">${esc(c.plate || '')}</div></td>
          <td>${A.pill(c.status, CAP_STATUS[c.status])}${c.isOnline ? ' <span class="pill pill--live">متصل</span>' : ''}</td>
          <td class="num ${c.balanceFils < 0 ? 'amt-neg' : ''}">${esc(c.balanceText)}</td>
          <td class="num">${c.trips}</td>
          <td class="num">${c.rating == null ? '—' : c.rating}</td>
          <td class="num">${c.docs}</td>
          <td>${manage && c.status === 'PENDING' ? `<button class="btn btn--ok" data-approve="${c.id}">موافقة</button>` : ''}</td>
        </tr>`,
    });
    node.querySelector('tbody').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-approve]'); if (!b) return;
      if (await act(b, () => API.post(api(`/captains/${b.dataset.approve}/status`), { status: 'APPROVED' }), 'تمت الموافقة على الكابتن')) { list.reload(); A.refreshCounts(); }
    });
  };

  async function captainDetail(main, id) {
    const { captain: c } = await API.get(api('/captains/' + id));
    const manage = A.can('captains.manage'), finance = A.can('finance');
    const v = c.vehicle;
    const btn = (status, label, cls) => c.status !== status ? `<button class="btn ${cls}" data-status="${status}">${label}</button>` : '';
    const node = render(main, `
      ${crumb('#/captains', 'الكباتن')}
      <div class="page__head">
        ${A.person(c.name, c.phone, c.photoUrl)}
        <div>${A.pill(c.status, CAP_STATUS[c.status])} ${c.isOnline ? '<span class="pill pill--live">متصل الآن</span>' : ''}</div>
        <div class="spacer"></div>
        <div class="actions">
          ${manage ? btn('APPROVED', c.status === 'PENDING' ? 'موافقة' : 'تفعيل', 'btn--ok') + btn('REJECTED', 'رفض', 'btn--ghost') + btn('SUSPENDED', 'إيقاف مؤقت', 'btn--warn') + btn('BLOCKED', 'حظر', 'btn--danger') : ''}
          ${manage && c.isOnline ? '<button class="btn btn--ghost" data-offline>فصل الكابتن</button>' : ''}
        </div>
      </div>
      ${c.statusReason ? `<div class="panel" style="background:var(--warning-100)"><b>سبب الحالة:</b> ${esc(c.statusReason)}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="kpi__label">الرصيد</div><div class="kpi__value ${c.wallet.balanceFils < 0 ? 'amt-neg' : ''}">${money(c.wallet.balanceFils)}</div></div>
        <div class="kpi"><div class="kpi__label">رحلات مكتملة</div><div class="kpi__value">${c.trips}</div></div>
        <div class="kpi"><div class="kpi__label">التقييم</div><div class="kpi__value">${c.rating == null ? '—' : c.rating}</div><div class="kpi__sub">${c.ratingCount || 0} تقييم</div></div>
        <div class="kpi"><div class="kpi__label">نسبة القبول</div><div class="kpi__value">${c.acceptanceRate == null ? '—' : c.acceptanceRate + '%'}</div></div>
        <div class="kpi"><div class="kpi__label">إلغاءات</div><div class="kpi__value">${c.cancellations}</div></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel__title"><h2>الوثائق</h2><div class="spacer"></div><span class="muted xs">اضغط على الصورة لتكبيرها</span></div>
          <div class="docs">${c.documents.map((d) => `
            <div class="doc"><div class="doc__img" data-file="${esc(d.fileId || '')}">تحميل…</div>
              <div class="doc__body"><div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b>${esc(DOC_LABEL[d.kind] || d.kind)}</b>${A.pill(d.status)}</div>
                <span class="xs muted-3">${esc(A.when(d.createdAt))}</span>
                ${manage ? `<div class="actions">${d.status !== 'APPROVED' ? `<button class="btn btn--ok" data-doc="${d.id}" data-v="APPROVED">قبول</button>` : ''}${d.status !== 'REJECTED' ? `<button class="btn btn--ghost" data-doc="${d.id}" data-v="REJECTED">رفض</button>` : ''}</div>` : ''}
              </div></div>`).join('') || '<p class="muted">ما رفع وثائق لسا.</p>'}</div>
        </div>
        <div class="panel"><div class="panel__title"><h2>المعلومات</h2></div>
          <dl class="dl">
            <dt>الهاتف</dt><dd class="num" style="text-align:end">${esc(c.phone)}</dd>
            <dt>المركبة</dt><dd>${v ? `${esc(v.type)} — ${esc([v.make, v.model, v.year].filter(Boolean).join(' '))}` : '—'}</dd>
            <dt>اللون</dt><dd>${esc((v && v.color) || '—')}</dd>
            <dt>رقم اللوحة</dt><dd class="num" style="text-align:end">${esc((v && v.plate) || '—')}</dd>
            <dt>تاريخ التسجيل</dt><dd>${esc(A.when(c.createdAt))}</dd>
            <dt>تاريخ الموافقة</dt><dd>${esc(A.when(c.approvedAt))}</dd>
            <dt>آخر موقع</dt><dd>${c.location ? `<a href="https://www.google.com/maps?q=${c.location.lat},${c.location.lng}" target="_blank" rel="noopener">افتح على الخريطة</a> · ${esc(A.when(c.location.updatedAt))}` : '—'}</dd>
          </dl>
        </div>
      </div>
      <div class="panel panel--flush">
        <div class="panel__title"><h2>المحفظة — آخر 30 حركة</h2><div class="spacer"></div>${finance ? '<button class="btn btn--primary" data-adjust>إضافة / خصم رصيد</button>' : ''}</div>
        <div class="table-wrap"><table class="t"><thead><tr><th>العملية</th><th>الوصف</th><th>المبلغ</th><th>الرصيد بعدها</th><th>الوقت</th></tr></thead><tbody>
          ${c.wallet.transactions.map((x) => `<tr><td>${esc(TX_LABEL[x.type] || x.type)}</td><td class="clip">${esc(x.description || '')}</td>
            <td class="num ${x.amountFils < 0 ? 'amt-neg' : 'amt-pos'}">${x.amountFils > 0 ? '+' : ''}${esc(x.amountText)}</td>
            <td class="num">${esc(x.balanceAfterText)}</td><td class="muted-cell">${esc(A.when(x.createdAt))}</td></tr>`).join('') || rowEmpty(5, 'ما في حركات')}
        </tbody></table></div>
      </div>
      <div class="panel panel--flush"><div class="panel__title"><h2>آخر الرحلات</h2></div>
        <div class="table-wrap"><table class="t" data-trips>${TRIP_TH}
          <tbody>${c.recentTrips.map(tripRowHtml).join('') || rowEmpty(6, 'ما في رحلات')}</tbody></table></div></div>`);

    node.querySelectorAll('[data-file]').forEach((h) => A.privateImage(h, h.dataset.file));
    openTrip(node.querySelector('[data-trips] tbody'));

    node.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
      const status = b.dataset.status;
      let body = { status };
      if (status === 'APPROVED') {
        if (!(await UI.confirm({ title: `${b.textContent} ${c.name || 'الكابتن'}؟`, body: 'رح يقدر يتصل ويستقبل رحلات فوراً.', confirmText: b.textContent }))) return;
      } else {
        const r = await A.ask({ title: `${b.textContent} — ${c.name || 'الكابتن'}`, body: 'الكابتن رح ينفصل فوراً وما بيستقبل رحلات. السبب بيظهر له بالتطبيق.', confirmText: b.textContent, danger: status !== 'REJECTED' });
        if (!r) return; body = { status, reason: r.reason };
      }
      if (await act(b, () => API.post(api(`/captains/${id}/status`), body), 'تم تحديث حالة الكابتن')) { A.refreshCounts(); A.route(); }
    });
    const off = node.querySelector('[data-offline]');
    if (off) off.onclick = async () => {
      if (!(await UI.confirm({ title: 'فصل الكابتن؟', body: 'رح يصير غير متصل وما توصله طلبات لحد ما يتصل من جديد.', confirmText: 'فصل' }))) return;
      if (await act(off, () => API.post(api(`/captains/${id}/offline`)), 'تم فصل الكابتن')) A.route();
    };
    node.querySelectorAll('[data-doc]').forEach((b) => b.onclick = async () => {
      if (await act(b, () => API.post(api('/documents/' + b.dataset.doc), { status: b.dataset.v }), b.dataset.v === 'APPROVED' ? 'انقبلت الوثيقة' : 'انرفضت الوثيقة')) A.route();
    });
    const adj = node.querySelector('[data-adjust]');
    if (adj) adj.onclick = async () => {
      const r = await A.ask({
        title: 'تعديل رصيد ' + (c.name || 'الكابتن'), body: `الرصيد الحالي ${A.jod(c.wallet.balanceFils)} دينار. العملية بتنسجل باسمك بسجل العمليات.`,
        confirmText: 'تنفيذ',
        extra: `<div class="form-grid" style="margin-bottom:12px">
          <div class="field-row"><label>النوع</label><select class="in" data-field="dir"><option value="1">إضافة للرصيد</option><option value="-1">خصم من الرصيد</option></select></div>
          <div class="field-row"><label>التصنيف</label><select class="in" data-field="type"><option value="ADJUSTMENT">تعديل</option><option value="BONUS">مكافأة</option><option value="CORRECTION">تصحيح</option><option value="REFUND">استرجاع</option></select></div>
          <div class="field-row"><label>المبلغ (دينار)</label><input class="in num-in" data-field="amount" inputmode="decimal" placeholder="5.000" style="max-width:none"></div>
        </div>`,
      });
      if (!r) return;
      const amount = A.toFils(r.amount) * Number(r.dir);
      if (!amount) { toast('اكتب مبلغ صحيح', 'error'); return; }
      const requestId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + Math.random().toString(16).slice(2);
      const res = await act(adj, () => API.post(api(`/captains/${id}/wallet`), { amountFils: amount, type: r.type, reason: r.reason, requestId }));
      if (res) { toast('الرصيد الجديد ' + res.balanceText + ' دينار', 'success'); A.route(); }
    };
  }

  /* ================================== شحن المحافظ ================================== */
  P.deposits = async (main) => {
    const node = render(main, `
      ${head('شحن المحافظ', 'الكابتن بحوّل عبر CliQ وبيرفع صورة الإشعار. تأكد إن المبلغ وصل حسابك قبل الموافقة.')}
      <div class="toolbar"><div class="tabs" data-tabs></div></div>
      <div data-list></div>`);
    const listEl = node.querySelector('[data-list]');
    const finance = A.can('finance');
    const LBL = { PENDING_REVIEW: 'بانتظار المراجعة', APPROVED: 'تمت الموافقة', REJECTED: 'مرفوض' };
    let status = 'PENDING_REVIEW';
    async function load() {
      listEl.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      const { deposits } = await API.get(api('/deposits?status=' + status));
      if (!deposits.length) {
        listEl.innerHTML = `<div class="panel muted" style="text-align:center;padding:40px">${status === 'PENDING_REVIEW' ? 'ما في طلبات شحن بانتظارك' : 'ما في طلبات'}</div>`;
        return;
      }
      listEl.innerHTML = `<div class="dep-list">${deposits.map((d) => `
        <div class="dep">
          <div class="dep__proof" data-file="${esc(d.proofId || '')}">تحميل الإشعار…</div>
          <div class="dep__body">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="dep__amount">${money(d.amountFils)}</div>${A.pill(d.status, LBL[d.status])}</div>
            <a href="#/captains/${d.captainId}" style="text-decoration:none;color:inherit">${A.person(d.captainName, d.captainPhone)}</a>
            <dl class="dl"><dt>رصيده الحالي</dt><dd class="num" style="text-align:end">${esc(d.balanceText)}</dd>
              <dt>تاريخ الطلب</dt><dd>${esc(A.when(d.createdAt))}</dd>
              ${d.reviewer ? `<dt>راجعه</dt><dd>${esc(d.reviewer)} · ${esc(A.when(d.reviewedAt))}</dd>` : ''}
              ${d.rejectReason ? `<dt>سبب الرفض</dt><dd>${esc(d.rejectReason)}</dd>` : ''}</dl>
            ${finance && d.status === 'PENDING_REVIEW' ? `<div class="actions"><button class="btn btn--ok" data-ok="${d.id}" data-amount="${esc(d.amountText)}" data-name="${esc(d.captainName || '')}">موافقة وإضافة الرصيد</button><button class="btn btn--ghost" data-no="${d.id}">رفض</button></div>` : ''}
          </div></div>`).join('')}</div>`;
      listEl.querySelectorAll('[data-file]').forEach((h) => A.privateImage(h, h.dataset.file));
    }
    tabs(node.querySelector('[data-tabs]'), Object.entries(LBL), status, (v) => { status = v; load().catch((e) => toast(e.message, 'error')); });
    listEl.addEventListener('click', async (e) => {
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]');
      if (ok) {
        if (!(await UI.confirm({ title: `إضافة ${ok.dataset.amount} دينار لمحفظة ${ok.dataset.name}؟`, body: 'متأكد إن الحوالة وصلت على CliQ؟ الموافقة ما بتنحسب مرتين.', confirmText: 'نعم، وصلت' }))) return;
        if (await act(ok, () => API.post(api(`/deposits/${ok.dataset.ok}/approve`)), 'انضاف الرصيد للكابتن')) { load(); A.refreshCounts(); }
      } else if (no) {
        const r = await A.ask({ title: 'رفض طلب الشحن', body: 'السبب بيظهر للكابتن (مثلاً: المبلغ ما وصل، الإشعار مش واضح).', confirmText: 'رفض', danger: true });
        if (r && await act(no, () => API.post(api(`/deposits/${no.dataset.no}/reject`), r), 'انرفض الطلب')) { load(); A.refreshCounts(); }
      }
    });
    await load();
  };

  /* ================================== العملاء ================================== */
  const USER_STATUS = { ACTIVE: 'فعّال', SUSPENDED: 'موقوف', BLOCKED: 'محظور' };
  P.customers = async (main, id) => {
    if (id) return customerDetail(main, id);
    const node = render(main, listShell(head('العملاء'), true, true, ['العميل', 'رحلات', 'إلغاءات', 'المخاطرة', 'الحالة', 'تاريخ التسجيل']));
    listPage(node, {
      url: '/customers', key: 'customers', cols: 6, searchPh: 'الاسم أو رقم الهاتف',
      filters: [['', 'الكل'], ['ACTIVE', 'فعّالين'], ['SUSPENDED', 'موقوفين'], ['BLOCKED', 'محظورين']],
      onRow: (uid) => { location.hash = '#/customers/' + uid; },
      row: (u) => `
        <tr class="link" data-id="${u.id}">
          <td>${A.person(u.name, u.phone, u.photoUrl)}</td>
          <td class="num">${u.trips}</td><td class="num">${u.cancellations}</td>
          <td>${riskPill(u.risk)}</td>
          <td>${A.pill(u.status, USER_STATUS[u.status])}${u.adminRole ? ' <span class="pill pill--live">مشرف</span>' : ''}</td>
          <td class="muted-cell">${esc(A.when(u.createdAt))}</td>
        </tr>`,
    });
  };

  async function customerDetail(main, id) {
    const { customer: u } = await API.get(api('/customers/' + id));
    const manage = A.can('customers.manage');
    const btn = (s, label, cls) => u.status !== s ? `<button class="btn ${cls}" data-status="${s}">${label}</button>` : '';
    const node = render(main, `
      ${crumb('#/customers', 'العملاء')}
      <div class="page__head">${A.person(u.name, u.phone, u.photoUrl)}<div>${A.pill(u.status, USER_STATUS[u.status])}</div><div class="spacer"></div>
        ${manage ? `<div class="actions">${btn('ACTIVE', 'تفعيل', 'btn--ok')}${btn('SUSPENDED', 'إيقاف مؤقت', 'btn--warn')}${btn('BLOCKED', 'حظر', 'btn--danger')}</div>` : ''}</div>
      ${u.statusReason ? `<div class="panel" style="background:var(--warning-100)"><b>سبب الحالة:</b> ${esc(u.statusReason)}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="kpi__label">رحلات مكتملة</div><div class="kpi__value">${u.completedTrips}</div></div>
        <div class="kpi"><div class="kpi__label">مجموع ما دفع</div><div class="kpi__value">${esc(u.spentText)} <small>د.أ</small></div></div>
        <div class="kpi"><div class="kpi__label">إلغاءات</div><div class="kpi__value">${u.cancellations}</div></div>
        <div class="kpi"><div class="kpi__label">المخاطرة</div><div class="kpi__value" style="font-size:18px">${riskPill(u.risk)}</div></div>
      </div>
      <div class="panel"><dl class="dl">
        <dt>الهاتف</dt><dd class="num" style="text-align:end">${esc(u.phone)}</dd>
        <dt>البريد</dt><dd>${esc(u.email || '—')}</dd>
        <dt>تاريخ التسجيل</dt><dd>${esc(A.when(u.createdAt))}</dd>
        <dt>آخر دخول</dt><dd>${esc(A.when(u.lastLoginAt))}</dd>
      </dl></div>
      <div class="panel panel--flush"><div class="panel__title"><h2>رحلاته</h2></div>
        <div class="table-wrap"><table class="t">${TRIP_TH}
          <tbody>${u.trips.map(tripRowHtml).join('') || rowEmpty(6, 'ما في رحلات')}</tbody></table></div></div>`);
    openTrip(node.querySelector('tbody'));
    node.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
      const status = b.dataset.status;
      const r = await A.ask({
        title: `${b.textContent} — ${u.name || u.phone}`, body: status === 'ACTIVE' ? '' : 'رح يطلع من التطبيق فوراً وما بيقدر يطلب رحلات.',
        required: status !== 'ACTIVE', confirmText: b.textContent, danger: status !== 'ACTIVE',
      });
      if (r && await act(b, () => API.post(api(`/customers/${id}/status`), { status, reason: r.reason || undefined }), 'تم التحديث')) A.route();
    });
  }

  /* ================================== الأسعار ================================== */
  P.pricing = async (main) => {
    const d = await API.get(api('/pricing'));
    const edit = A.can('pricing');
    const FIELDS = [
      ['baseFils', 'فتح العداد', 'jod'], ['perKmFils', 'لكل كيلو', 'jod'], ['perMinFils', 'لكل دقيقة', 'jod'],
      ['minFils', 'أقل أجرة', 'jod'], ['waitingPerMinFils', 'انتظار لكل دقيقة', 'jod'], ['freeWaitingSec', 'انتظار مجاني (دقيقة)', 'min'],
      ['cancelFils', 'رسوم الإلغاء', 'jod'], ['peakBp', 'مضاعف الذروة (×)', 'x'],
    ];
    const show = (r, [k, , kind]) => kind === 'jod' ? A.jod(r[k]) : kind === 'min' ? String(r[k] / 60) : (r[k] / 10000).toFixed(2);
    const read = (v, kind) => kind === 'jod' ? A.toFils(v) : kind === 'min' ? Math.round(Number(v) * 60) : Math.round(Number(v) * 10000);
    const sample = (r) => A.jod(Math.round((Math.max(r.minFils, r.baseFils + 5 * r.perKmFils + 10 * r.perMinFils) * r.peakBp / 10000) / 50) * 50);
    const byCity = {};
    d.rules.forEach((r) => { (byCity[r.cityCode] = byCity[r.cityCode] || { name: r.city, active: r.cityActive, rules: [] }).rules.push(r); });
    const node = render(main, `
      ${head('الأسعار', `كل المبالغ بالدينار. عمولة نشمي الحالية <b class="num">${(d.commissionBp / 100).toFixed(2)}%</b> وبتتغير من «الإعدادات». التعديل بيطبق على الطلبات الجديدة فوراً.`)}
      ${Object.values(byCity).map((city) => `
        <div class="panel" style="${city.active ? '' : 'opacity:.65'}">
          <div class="panel__title"><h2>${esc(city.name)}</h2>${city.active ? '<span class="pill pill--ok">مفعّلة</span>' : '<span class="pill">غير مفعّلة</span>'}</div>
          <div style="display:grid;gap:18px">${city.rules.map((r) => `
            <div data-rule="${r.id}" style="border-top:1px solid var(--border);padding-top:14px">
              <div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><b style="font-size:16px">${esc(r.vehicle)}</b>
                <span class="muted sm">مثال: رحلة 5 كم و10 دقائق = <b class="num" data-sample>${sample(r)}</b> د.أ</span></div>
              <div class="form-grid">${FIELDS.map((f) => `
                <div class="field-row"><label>${f[1]}</label><input class="in num-in" style="max-width:none" data-k="${f[0]}" data-kind="${f[2]}" value="${show(r, f)}" inputmode="decimal" ${edit ? '' : 'disabled'}></div>`).join('')}
                ${edit ? '<button class="btn btn--primary" data-save disabled>حفظ</button>' : ''}
              </div>
            </div>`).join('')}</div>
        </div>`).join('')}`);
    node.querySelectorAll('[data-rule]').forEach((box) => {
      const r = d.rules.find((x) => x.id === box.dataset.rule);
      const save = box.querySelector('[data-save]');
      const values = () => { const o = {}; box.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = read(i.value, i.dataset.kind); }); return o; };
      box.addEventListener('input', () => {
        const v = values();
        const valid = Object.values(v).every((x) => Number.isFinite(x) && x >= 0);
        if (valid) box.querySelector('[data-sample]').textContent = sample({ ...r, ...v });
        if (save) save.disabled = !valid || FIELDS.every(([k]) => v[k] === r[k]);
      });
      if (save) save.onclick = async () => {
        const res = await A.ask({ title: `تعديل أسعار ${r.vehicle} — ${r.city}`, body: 'التعديل بينسجل بسجل العمليات.', confirmText: 'حفظ الأسعار' });
        if (!res) return;
        const v = values();
        if (await act(save, () => API.patch(api('/pricing/' + r.id), { ...v, reason: res.reason }), 'انحفظت الأسعار')) { Object.assign(r, v); save.disabled = true; }
      };
    });
  };

  /* ================================== الإعدادات ================================== */
  P.settings = async (main) => {
    const d = await API.get(api('/settings'));
    const edit = A.can('settings');
    const HIDE = ['platform.currency', 'platform.default_language'];
    const pct = { unit: '%', to: (v) => String(v / 100), from: (x) => Math.round(Number(x) * 100) };
    const UNIT = {
      'platform.commission_bp': { label: 'عمولة نشمي من كل رحلة', ...pct },
      'wallet.min_balance_fils': { label: 'أدنى رصيد مسموح للكابتن ليستقبل رحلات (سالب = دين مسموح)', unit: 'دينار', to: (v) => A.jod(v), from: (x) => A.toFils(x) },
      'fare.recalc_threshold_bp': { label: 'إعادة حساب الأجرة إذا زادت المسافة الفعلية عن التقدير بنسبة', ...pct },
      'wallet.cliq_alias': { label: 'اسم CliQ اللي بيحوّل عليه الكباتن لشحن محافظهم' },
    };
    const GROUPS = [['platform.', 'المنصة والعمولة'], ['wallet.', 'المحفظة'], ['dispatch.', 'توزيع الطلبات'], ['cancel.', 'الإلغاء'], ['trip.', 'الرحلات'], ['captain.', 'الكباتن'], ['fare.', 'الأجرة']];
    const rows = d.settings.filter((s) => !HIDE.includes(s.key));
    const group = (prefix) => rows.filter((s) => s.key.startsWith(prefix));
    const node = render(main, `
      ${head('الإعدادات', 'كل تغيير بيطبق فوراً بدون إعادة تشغيل، وبينسجل مع السبب.')}
      <div class="panel"><div class="panel__title"><h2>مناطق الخدمة</h2></div>
        <div style="display:grid;gap:12px">${d.cities.map((c) => `
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <b style="min-width:110px">${esc(c.name)}</b><span class="muted sm">نطاق <span class="num">${c.radiusKm}</span> كم</span>
            ${c.isActive ? '<span class="pill pill--ok">مفعّلة</span>' : '<span class="pill">موقفة</span>'}
            <div style="flex:1"></div>
            ${c.envManaged ? `<span class="muted xs">بتتحكم فيها من Render: SERVICE_ALL_JORDAN</span>`
              : edit ? `<button class="btn ${c.isActive ? 'btn--ghost' : 'btn--ok'}" data-city="${c.id}" data-on="${c.isActive ? 0 : 1}">${c.isActive ? 'إيقاف' : 'تفعيل'}</button>` : ''}
          </div>`).join('')}</div></div>
      ${GROUPS.map(([p, title]) => group(p).length ? `
        <div class="panel"><div class="panel__title"><h2>${title}</h2></div>
          <div style="display:grid;gap:14px">${group(p).map((s) => {
            const u = UNIT[s.key] || {};
            const val = u.to ? u.to(Number(s.value)) : s.value;
            const isNum = s.type === 'int';
            return `<div data-set="${esc(s.key)}" class="field-row">
              <label>${esc(u.label || s.label || s.key)}${u.unit ? ` (${u.unit})` : ''}</label>
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <input class="in ${isNum ? 'num-in' : ''}" style="max-width:${isNum ? '200px' : '360px'}" value="${esc(val)}" ${isNum ? 'inputmode="decimal"' : ''} ${edit ? '' : 'disabled'}>
                ${edit ? '<button class="btn btn--primary" data-save disabled>حفظ</button>' : ''}
              </div>
            </div>`;
          }).join('')}</div></div>` : '').join('')}`);

    node.querySelectorAll('[data-set]').forEach((row) => {
      const s = d.settings.find((x) => x.key === row.dataset.set);
      const u = UNIT[s.key] || {};
      const input = row.querySelector('input'), save = row.querySelector('[data-save]');
      const value = () => (u.from ? u.from(input.value) : s.type === 'int' ? Number(input.value) : input.value.trim());
      input.oninput = () => { if (save) save.disabled = String(value()) === String(s.value); };
      if (save) save.onclick = async () => {
        const v = value();
        if (s.type === 'int' && !Number.isInteger(v)) { toast('القيمة لازم تكون رقم', 'error'); return; }
        const r = await A.ask({ title: 'تعديل: ' + (u.label || s.label), confirmText: 'حفظ' });
        if (r && await act(save, () => API.patch(api('/settings/' + encodeURIComponent(s.key)), { value: v, reason: r.reason }), 'انحفظ الإعداد')) { s.value = String(v); save.disabled = true; }
      };
    });
    node.querySelectorAll('[data-city]').forEach((b) => b.onclick = async () => {
      const on = b.dataset.on === '1';
      if (!(await UI.confirm({ title: on ? 'تفعيل المنطقة؟' : 'إيقاف الخدمة بهذه المنطقة؟', body: on ? '' : 'العملاء بهذه المنطقة ما رح يقدروا يطلبوا.', confirmText: on ? 'تفعيل' : 'إيقاف', danger: !on }))) return;
      if (await act(b, () => API.patch(api('/cities/' + b.dataset.city), { isActive: on }), 'تم')) A.route();
    });
  };

  /* ================================== المشرفون ================================== */
  P.admins = async (main) => {
    const d = await API.get(api('/admins'));
    const roles = A.me.roles || [];
    const DESC = {
      SUPER_ADMIN: 'كل شي', FINANCE_ADMIN: 'شحن المحافظ وتعديل الأرصدة', DISPATCH_ADMIN: 'الرحلات والكباتن',
      SUPPORT_ADMIN: 'الرحلات والعملاء', MODERATOR: 'مشاهدة فقط',
    };
    const node = render(main, `
      ${head('المشرفون', 'أضف ناس يساعدوك بالإدارة وحدد شو بيقدروا يعملوا. رقم المالك (ADMIN_PHONES) صلاحيته ثابتة.')}
      <div class="panel"><div class="panel__title"><h2>إضافة مشرف</h2></div>
        <div class="form-grid">
          <div class="field-row"><label>رقم الهاتف</label><input class="in" data-phone inputmode="tel" placeholder="07XXXXXXXX" style="direction:ltr;text-align:start"></div>
          <div class="field-row"><label>الاسم (اختياري)</label><input class="in" data-name></div>
          <div class="field-row"><label>الصلاحية</label><select class="in" data-role>${roles.map((r) => `<option value="${r.key}" ${r.key === 'SUPPORT_ADMIN' ? 'selected' : ''}>${esc(r.label)} — ${esc(DESC[r.key] || '')}</option>`).join('')}</select></div>
          <button class="btn btn--primary" data-add>إضافة</button>
        </div>
        <p class="muted xs" style="margin:10px 0 0">المشرف الجديد بيدخل على نفس الرابط ‎/admin‎ برقمه ورمز التحقق.</p>
      </div>
      <div class="panel panel--flush"><div class="table-wrap"><table class="t">
        <thead><tr><th>المشرف</th><th>الصلاحية</th><th>آخر دخول</th><th></th></tr></thead>
        <tbody>${d.admins.map((a) => `<tr>
          <td>${A.person(a.name, a.phone)}</td>
          <td><span class="pill ${a.role === 'SUPER_ADMIN' ? 'pill--live' : ''}">${esc(a.roleLabel || a.role)}</span>${a.isOwner ? ' <span class="pill pill--ok">المالك</span>' : ''}</td>
          <td class="muted-cell">${esc(A.when(a.lastLoginAt))}</td>
          <td>${a.isOwner || a.id === A.me.user.id ? '' : `<button class="btn btn--ghost" data-remove="${a.id}" data-name="${esc(a.name || a.phone)}">إزالة</button>`}</td>
        </tr>`).join('')}</tbody></table></div></div>`);
    const add = node.querySelector('[data-add]');
    add.onclick = async () => {
      const body = { phone: node.querySelector('[data-phone]').value.trim(), name: node.querySelector('[data-name]').value.trim() || undefined, role: node.querySelector('[data-role]').value };
      if (!body.phone) { toast('اكتب رقم الهاتف', 'error'); return; }
      if (await act(add, () => API.post(api('/admins'), body), 'انضاف المشرف')) A.route();
    };
    node.querySelectorAll('[data-remove]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm({ title: `إزالة صلاحية ${b.dataset.name}؟`, body: 'حسابه بيضل موجود بس ما بيقدر يدخل لوحة الإدارة.', confirmText: 'إزالة', danger: true }))) return;
      if (await act(b, () => API.del(api('/admins/' + b.dataset.remove)), 'انشالت الصلاحية')) A.route();
    });
  };

  /* ================================== سجل العمليات ================================== */
  const ENTITY_LINK = { captain: '#/captains/', trip: '#/trips/', user: '#/customers/' };
  const ENTITY_LABEL = { captain: 'كابتن', trip: 'رحلة', user: 'حساب', deposit_request: 'طلب شحن', pricing_rule: 'تسعيرة', setting: 'إعداد', city: 'منطقة', captain_document: 'وثيقة' };
  const diff = (b, a) => {
    if (!b && !a) return '';
    const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])];
    const v = (o, k) => (o && o[k] !== undefined && o[k] !== null ? o[k] : '—');
    return keys.map((k) => `${k}: ${v(b, k)} → ${v(a, k)}`).join(' · ');
  };
  P.audit = async (main) => {
    const node = render(main, listShell(head('سجل العمليات', 'كل إجراء حساس بينسجل هون: مين عمله، إمتى، قبل وبعد، والسبب. السجل ما بينمسح.'), false, false,
      ['الوقت', 'مين', 'العملية', 'على', 'التغيير', 'السبب']));
    listPage(node, {
      url: '/audit', key: 'logs', cols: 6,
      row: (l) => `<tr>
        <td class="muted-cell" style="white-space:nowrap">${esc(A.when(l.createdAt))}</td>
        <td>${esc(l.actor || '—')}</td>
        <td><b>${esc(l.label)}</b></td>
        <td>${ENTITY_LINK[l.entity] && l.entityId ? `<a href="${ENTITY_LINK[l.entity]}${esc(l.entityId)}">${esc(ENTITY_LABEL[l.entity] || l.entity)}</a>` : esc(ENTITY_LABEL[l.entity] || l.entity || '')}${l.entity === 'setting' ? ` <span class="change">${esc(l.entityId)}</span>` : ''}</td>
        <td class="clip" style="max-width:340px"><span class="change">${esc(diff(l.before, l.after))}</span></td>
        <td class="clip">${esc(l.reason || '')}</td></tr>`,
    });
  };
})();
