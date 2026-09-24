/* ==========================================================
   لوحة الإدارة — المحادثات (الدعم الفني)، الإشعارات الجماعية، الأماكن، صور السيارات (Style Bible).
   ========================================================== */
(function () {
  const { el, esc, toast } = UI;
  const A = window.Admin;
  const P = A.Pages;
  const api = (p) => '/api/admin' + p;

  function render(main, html) {
    main.innerHTML = '';
    const node = el(`<div class="page">${html}</div>`);
    main.appendChild(node);
    return node;
  }
  const head = (title, sub = '', right = '') => `
    <div class="page__head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="spacer"></div>${right}</div>`;
  async function act(btn, fn, okText) {
    if (btn) UI.busy(btn, true);
    try { const r = await fn(); if (okText) toast(okText, 'success'); return r || true; }
    catch (e) { toast(e.message || 'صار خطأ', 'error'); return false; }
    finally { if (btn && btn.isConnected) UI.busy(btn, false); }
  }
  const time = (iso) => { try { return new Date(iso).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  /* ================================ المحادثات ================================ */
  const TOPIC_PILL = { lost_item: 'warn', report_captain: 'bad', report_rider: 'bad', trip_issue: 'warn', payment: 'live' };
  const QUICK = [
    'أهلاً فيك، معك فريق نشمي 🌷 كيف بنقدر نساعدك؟',
    'تواصلنا مع الكابتن ورح نرجعلك بأقرب وقت.',
    'الكابتن لقى الغرض ✓ رح نرتب معك وقت ومكان الاستلام.',
    'شكراً لبلاغك، رح نراجع الرحلة ونتخذ الإجراء المناسب.',
    'تم حل المشكلة ✓ إذا بدك إشي ثاني احكيلنا.',
  ];

  P.chats = async (main, id) => {
    const st = { kind: 'support', filter: 'unread', side: '' };
    const node = render(main, `
      ${head('المحادثات', 'رسائل الزباين والكباتن للدعم، والإبلاغات والأغراض المنسية. محادثات الرحلات للقراءة وقت الشكاوى.',
        '<button class="btn btn--primary" data-new>رسالة جديدة</button>')}
      <div class="toolbar"><div class="tabs" data-tabs></div><div class="tabs" data-side></div></div>
      <div class="inbox ${id ? 'inbox--open' : ''}">
        <div class="panel panel--flush inbox__list" data-list><div class="skeleton" style="height:70px;margin:12px"></div></div>
        <div class="panel panel--flush inbox__thread" data-thread>
          <div class="inbox__empty">${Icon('chat', 48)}<p>اختار محادثة من القائمة</p></div>
        </div>
      </div>`);
    const list = node.querySelector('[data-list]');
    const threadBox = node.querySelector('[data-thread]');

    const tabsHost = node.querySelector('[data-tabs]');
    const TABS = [['unread', 'بتستنى رد'], ['open', 'مفتوحة'], ['closed', 'مغلقة'], ['all', 'الكل'], ['trip', 'محادثات الرحلات']];
    tabsHost.innerHTML = TABS.map(([v, l]) => `<button data-v="${v}" class="${v === st.filter ? 'on' : ''}">${l}</button>`).join('');
    tabsHost.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      tabsHost.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (b.dataset.v === 'trip') { st.kind = 'trip'; } else { st.kind = 'support'; st.filter = b.dataset.v; }
      loadList();
    };
    const sideHost = node.querySelector('[data-side]');
    sideHost.innerHTML = [['', 'الكل'], ['customer', 'زباين'], ['captain', 'كباتن']].map(([v, l]) => `<button data-v="${v}" class="${v === st.side ? 'on' : ''}">${l}</button>`).join('');
    sideHost.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      sideHost.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      st.side = b.dataset.v; loadList();
    };

    let seq = 0;
    async function loadList() {
      const my = ++seq;
      const qs = new URLSearchParams({ kind: st.kind, filter: st.filter });
      if (st.side) qs.set('side', st.side);
      try {
        const d = await API.get(api('/chats?' + qs));
        if (my !== seq || !node.isConnected) return;
        if (!d.threads.length) { list.innerHTML = `<p class="muted sm" style="padding:20px;text-align:center">ما في محادثات هون</p>`; return; }
        list.innerHTML = d.threads.map((t) => {
          const who = t.kind === 'trip' ? `${t.user ? t.user.name || 'زبون' : 'زبون'} ↔ ${t.peer ? t.peer.name || 'كابتن' : 'كابتن'}` : (t.user && (t.user.name || t.user.phone)) || '—';
          return `<a class="inbox__row ${t.id === id ? 'on' : ''} ${t.unread ? 'unread' : ''}" href="#/chats/${t.id}">
            ${UI.avatar(t.user || {})}
            <span class="inbox__row-body">
              <span class="inbox__row-top"><b>${esc(who)}</b><small>${esc(A.when(t.lastMessageAt))}</small></span>
              <span class="inbox__row-mid">
                ${t.kind === 'support' ? `<span class="pill ${TOPIC_PILL[t.topic] ? 'pill--' + TOPIC_PILL[t.topic] : ''}">${esc(t.topicLabel)}</span>
                <span class="pill">${t.side === 'captain' ? 'كابتن' : 'زبون'}</span>` : '<span class="pill">رحلة</span>'}
                ${t.trip ? `<span class="num xs muted-3">${esc(t.trip.code)}</span>` : ''}
                ${t.status === 'CLOSED' ? '<span class="xs muted-3">مغلقة</span>' : ''}
              </span>
              <span class="inbox__row-prev">${t.lastSenderRole === 'admin' ? 'أنت: ' : ''}${esc(t.lastPreview || '')}</span>
            </span>
            ${t.unread ? `<span class="count">${t.unread}</span>` : ''}
          </a>`;
        }).join('');
      } catch (e) { list.innerHTML = `<p class="muted sm" style="padding:20px">${esc(e.message)}</p>`; }
    }
    loadList();
    A.every(10000, loadList, node);

    node.querySelector('[data-new]').onclick = () => newChat();

    if (id) openThread(id);

    async function openThread(tid) {
      threadBox.innerHTML = '<div class="skeleton" style="height:200px;margin:16px"></div>';
      let last = null, msgs = [];
      const d = await API.get(api('/chats/' + tid));
      const t = d.thread;
      msgs = d.messages;
      const readOnly = t.kind === 'trip';
      const canMsgCaptain = t.trip && t.trip.captainUserId && t.kind === 'support' && t.side === 'customer';
      threadBox.innerHTML = `
        <div class="thread__head">
          <a class="icon-btn thread__back" href="#/chats" aria-label="رجوع">${Icon('back', 20)}</a>
          ${A.person(t.kind === 'trip' ? `${(t.user && t.user.name) || 'زبون'} ↔ ${(t.peer && t.peer.name) || 'كابتن'}` : t.user && t.user.name, t.user && t.user.phone, t.user && t.user.photoUrl)}
          <div class="spacer"></div>
          ${t.kind === 'support' ? `<span class="pill ${TOPIC_PILL[t.topic] ? 'pill--' + TOPIC_PILL[t.topic] : ''}">${esc(t.topicLabel)}</span>` : ''}
        </div>
        ${t.trip ? `<div class="thread__trip">
          ${Icon('car', 16)} <a href="#/trips/${t.trip.id}">رحلة <b class="num">${esc(t.trip.code)}</b></a>
          <span class="muted-3 clip">${esc(t.trip.from || '')} ← ${esc(t.trip.to || '')}</span>
          ${t.trip.captain ? `<span>· الكابتن: <b>${esc(t.trip.captain.name || '')}</b> <span class="num">${esc(t.trip.captain.phone || '')}</span></span>` : ''}
        </div>` : ''}
        <div class="thread__actions">
          ${canMsgCaptain ? `<button class="btn btn--ghost btn--sm" data-cap>${Icon('chat', 16)} راسل الكابتن عن هاي الرحلة</button>` : ''}
          ${t.kind === 'support' ? (t.status === 'OPEN'
            ? '<button class="btn btn--ghost btn--sm" data-close>إغلاق المحادثة ✓</button>'
            : '<button class="btn btn--ghost btn--sm" data-reopen>إعادة فتح</button>') : '<span class="muted xs">محادثة بين الزبون والكابتن — للقراءة فقط</span>'}
        </div>
        <div class="thread__msgs" data-msgs></div>
        ${readOnly ? '' : `
        <div class="thread__quick">${QUICK.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q.length > 34 ? q.slice(0, 33) + '…' : q)}</button>`).join('')}</div>
        <form class="thread__bar" data-form>
          <textarea class="in" data-input rows="2" placeholder="اكتب ردك… (Enter للإرسال، Shift+Enter لسطر جديد)"></textarea>
          <button class="btn btn--primary" type="submit">إرسال</button>
        </form>`}`;
      const box = threadBox.querySelector('[data-msgs]');
      const ROLE = { customer: 'الزبون', captain: 'الكابتن', admin: 'الإدارة', system: 'رد تلقائي' };
      const draw = () => {
        box.innerHTML = msgs.map((m) => `<div class="amsg amsg--${m.senderRole === 'admin' ? 'me' : m.senderRole === 'system' ? 'sys' : 'them'}">
          <div class="amsg__who">${esc(ROLE[m.senderRole] || '')}</div>
          <div class="amsg__body">${esc(m.body).replace(/\n/g, '<br>')}</div>
          <div class="amsg__time">${esc(A.when(m.createdAt))}</div></div>`).join('') || '<p class="muted sm" style="text-align:center">ما في رسائل</p>';
        box.scrollTop = box.scrollHeight;
      };
      draw();
      last = msgs.length ? msgs[msgs.length - 1].createdAt : null;
      A.every(5000, async () => {
        try {
          const r = await API.get(api('/chats/' + tid + (last ? '?after=' + encodeURIComponent(last) : '')));
          const known = new Set(msgs.map((m) => m.id));
          const fresh = r.messages.filter((m) => !known.has(m.id));
          if (fresh.length) { msgs.push(...fresh); last = fresh[fresh.length - 1].createdAt; draw(); }
        } catch {}
      }, threadBox);

      const form = threadBox.querySelector('[data-form]');
      if (form) {
        const input = form.querySelector('[data-input]');
        const send = async (text) => {
          text = String(text || '').trim(); if (!text) return;
          const btn = form.querySelector('button');
          const r = await act(btn, () => API.post(api('/chats/' + tid + '/messages'), { body: text }));
          if (r && r.message) { msgs.push(r.message); last = r.message.createdAt; draw(); input.value = ''; loadList(); A.refreshCounts(); }
        };
        form.onsubmit = (e) => { e.preventDefault(); send(input.value); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
        threadBox.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { input.value = b.dataset.q; input.focus(); });
        input.focus();
      }
      const cl = threadBox.querySelector('[data-close]');
      if (cl) cl.onclick = async () => { if (await act(cl, () => API.post(api('/chats/' + tid + '/status'), { status: 'CLOSED' }), 'انغلقت المحادثة')) { loadList(); openThread(tid); A.refreshCounts(); } };
      const ro = threadBox.querySelector('[data-reopen]');
      if (ro) ro.onclick = async () => { if (await act(ro, () => API.post(api('/chats/' + tid + '/status'), { status: 'OPEN' }), 'انفتحت')) openThread(tid); };
      const cap = threadBox.querySelector('[data-cap]');
      if (cap) cap.onclick = () => newChat({
        userId: t.trip.captainUserId, side: 'captain', tripId: t.trip.id, topic: t.topic === 'lost_item' ? 'lost_item' : 'captain_admin',
        text: t.topic === 'lost_item' ? `مرحبا كابتن، زبون رحلة ${t.trip.code} نسي غرض بسيارتك. شيّك عليه لو سمحت وخبّرنا.` : `مرحبا كابتن، بخصوص رحلة ${t.trip.code}: `,
        title: `رسالة للكابتن ${t.trip.captain ? t.trip.captain.name || '' : ''}`,
      });
      A.refreshCounts();
    }

    /** رسالة جديدة لزبون أو كابتن (برقم التلفون، أو من محادثة موجودة) */
    function newChat(pre = {}) {
      const wrap = el(`
        <div class="modal-host"><div class="modal">
          <h2 class="h2" style="margin-bottom:12px">${esc(pre.title || 'رسالة جديدة')}</h2>
          ${pre.userId ? '' : `
          <div class="field-row" style="margin-bottom:10px"><label>رقم الهاتف</label><input class="in" data-phone inputmode="tel" placeholder="07XXXXXXXX" style="direction:ltr;text-align:start"></div>
          <div class="field-row" style="margin-bottom:10px"><label>الرسالة بتوصل على تطبيق</label>
            <select class="in" data-side><option value="customer">الزبون</option><option value="captain">الكابتن</option></select></div>`}
          <div class="field-row" style="margin-bottom:14px"><label>الرسالة</label><textarea class="in" data-body rows="4" style="min-height:100px;padding:10px">${esc(pre.text || '')}</textarea></div>
          <div class="actions"><button class="btn btn--primary" data-send>إرسال</button><button class="btn btn--ghost" data-no>تراجع</button></div>
        </div></div>`);
      document.getElementById('modal').appendChild(wrap);
      wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
      wrap.querySelector('[data-no]').onclick = () => wrap.remove();
      wrap.querySelector('[data-send]').onclick = async (e) => {
        const body = { body: wrap.querySelector('[data-body]').value.trim(), topic: pre.topic, tripId: pre.tripId };
        if (pre.userId) { body.userId = pre.userId; body.side = pre.side; }
        else { body.phone = wrap.querySelector('[data-phone]').value.trim(); body.side = wrap.querySelector('[data-side]').value; }
        const r = await act(e.currentTarget, () => API.post(api('/chats/start'), body), 'انبعتت الرسالة');
        if (r && r.thread) { wrap.remove(); location.hash = '#/chats/' + r.thread.id; }
      };
    }
  };

  /* ============================ الإشعارات الجماعية ============================ */
  P.broadcasts = async (main) => {
    const d = await API.get(api('/broadcasts'));
    const pushOf = (app) => d.push.filter((p) => p.app === app).reduce((n, p) => n + p.count, 0);
    const node = render(main, `
      ${head('الإشعارات والعروض', 'ابعت عرض أو كود خصم أو تنبيه — بيوصل إشعار على التلفون، وبيضل محفوظ بصندوق الإشعارات بالتطبيق.')}
      <div class="kpis">
        <div class="kpi"><div class="kpi__label">زباين</div><div class="kpi__value">${d.reach.customers}</div><div class="kpi__sub">${pushOf('customer')} جهاز مفعّل الإشعارات</div></div>
        <div class="kpi"><div class="kpi__label">كباتن معتمدين</div><div class="kpi__value">${d.reach.captains}</div><div class="kpi__sub">${pushOf('captain')} جهاز مفعّل الإشعارات</div></div>
      </div>
      <div class="panel"><div class="panel__title"><h2>رسالة جديدة</h2></div>
        <div class="bc-grid">
          <div style="display:grid;gap:12px">
            <div class="field-row"><label>لمين؟</label><div class="tabs" data-aud>
              ${Object.entries(d.audiences).map(([k, l], i) => `<button data-v="${k}" class="${i === 0 ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>
            <div class="field-row"><label>العنوان</label><input class="in" data-title maxlength="80" placeholder="مثال: خصم الويكند 🎉"></div>
            <div class="field-row"><label>النص</label><textarea class="in" data-body rows="4" maxlength="600" style="min-height:100px;padding:10px" placeholder="خصم 20% على كل رحلاتك يوم الجمعة والسبت"></textarea></div>
            <div class="field-row"><label>كود خصم (اختياري)</label><input class="in" data-code maxlength="30" placeholder="NASHMI20" style="direction:ltr;text-align:start;max-width:220px;text-transform:uppercase"></div>
            <button class="btn btn--primary" data-send style="justify-self:start">إرسال</button>
          </div>
          <div><div class="muted xs" style="margin-bottom:8px">هيك بيبين على التلفون</div>
            <div class="push-prev"><img src="/img/logo-mark.png" alt=""><div><b data-p-title>العنوان</b><span data-p-body>النص</span></div></div>
            <p class="muted xs" style="margin-top:12px">الإشعار الفوري بيوصل للي فعّلوا الإشعارات. الباقي بيشوفوها بصندوق الإشعارات أول ما يفتحوا التطبيق.</p>
          </div>
        </div>
      </div>
      <div class="panel panel--flush"><div class="panel__title"><h2>المرسل سابقاً</h2></div><div class="table-wrap"><table class="t">
        <thead><tr><th>الرسالة</th><th>لمين</th><th>الكود</th><th>وصلت لـ</th><th>إشعار فوري</th><th>التاريخ</th></tr></thead>
        <tbody>${d.broadcasts.map((b) => `<tr>
          <td class="clip" style="max-width:320px"><b>${esc(b.title)}</b><div class="muted-cell clip">${esc(b.body)}</div></td>
          <td>${esc(b.audienceLabel || b.audience)}</td><td class="num">${esc(b.code || '—')}</td>
          <td class="num">${b.sent}</td><td class="num">${b.pushed}</td><td class="muted-cell">${esc(A.when(b.createdAt))}</td></tr>`).join('')
          || '<tr><td class="empty-row" colspan="6">ما انبعت إشي لسا</td></tr>'}</tbody></table></div></div>`);
    let aud = Object.keys(d.audiences)[0];
    const audHost = node.querySelector('[data-aud]');
    audHost.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; audHost.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); aud = b.dataset.v; };
    const ti = node.querySelector('[data-title]'), bo = node.querySelector('[data-body]'), co = node.querySelector('[data-code]');
    const prev = () => {
      node.querySelector('[data-p-title]').textContent = ti.value || 'العنوان';
      node.querySelector('[data-p-body]').textContent = (bo.value || 'النص') + (co.value ? `\nالكود: ${co.value.toUpperCase()}` : '');
    };
    [ti, bo, co].forEach((x) => x.oninput = prev);
    node.querySelector('[data-send]').onclick = async (e) => {
      if (!ti.value.trim() || !bo.value.trim()) return toast('اكتب العنوان والنص', 'error');
      if (!(await UI.confirm({ title: `إرسال لـ ${d.audiences[aud]}؟`, body: 'ما بينفع ترجعها بعد الإرسال.', confirmText: 'إرسال' }))) return;
      const r = await act(e.currentTarget, () => API.post(api('/broadcasts'), { audience: aud, title: ti.value.trim(), body: bo.value.trim(), code: co.value.trim() || undefined }));
      if (r) { toast(`انبعتت لـ ${r.recipients} شخص`, 'success'); A.route(); }
    };
  };

  /* ============================== الأماكن المشهورة ============================== */
  P.places = async (main) => {
    const d = await API.get(api('/pois'));
    const node = render(main, `
      ${head('الأماكن المشهورة', 'المحلات والمستشفيات والجامعات والدواوين الي بتضيفها هون بتطلع <b>أول نتيجة</b> لما الزبون يبحث — حتى لو مش موجودة على الخرائط.')}
      <div class="panel"><div class="panel__title"><h2>إضافة مكان</h2><span class="muted xs">اضغط على الخريطة لتحديد المكان بالضبط</span></div>
        <div class="map-box" data-map></div>
        <div class="form-grid" style="margin-top:12px">
          <div class="field-row"><label>الاسم</label><input class="in" data-name maxlength="80" placeholder="مثال: مستشفى الكرك الحكومي"></div>
          <div class="field-row"><label>النوع</label><select class="in" data-cat>${Object.entries(d.categories).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
          <div class="field-row"><label>وصف/عنوان (اختياري)</label><input class="in" data-addr maxlength="160" placeholder="الثنية، بجانب…"></div>
          <button class="btn btn--primary" data-add disabled>إضافة</button>
        </div></div>
      <div class="toolbar"><input class="search" data-q type="search" placeholder="ابحث (عبدلي = العبدلي)"></div>
      <div class="panel panel--flush"><div class="table-wrap"><table class="t">
        <thead><tr><th>المكان</th><th>النوع</th><th>الموقع</th><th></th></tr></thead><tbody data-rows></tbody></table></div></div>`);
    let picked = null, marker = null;
    const map = MapKit.create(node.querySelector('[data-map]'), { zoom: 13 });
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    A.onLeave(() => { map._gone = true; try { map.remove(); } catch {} });
    setTimeout(() => { if (!map._gone) map.invalidateSize(); }, 80);
    const add = node.querySelector('[data-add]');
    map.on('click', (e) => {
      picked = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (marker) marker.setLatLng(e.latlng); else marker = L.marker(e.latlng, { icon: MapKit.destIcon('هون') }).addTo(map);
      add.disabled = false;
    });
    const rows = node.querySelector('[data-rows]');
    const pins = L.layerGroup().addTo(map);
    const draw = (list) => {
      rows.innerHTML = list.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.address ? `<div class="muted-cell">${esc(p.address)}</div>` : ''}</td>
        <td>${esc(p.categoryLabel)}</td><td class="num muted-cell">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</td>
        <td><button class="btn btn--ghost btn--sm" data-del="${p.id}" data-n="${esc(p.name)}">حذف</button></td></tr>`).join('')
        || '<tr><td class="empty-row" colspan="4">ما في أماكن لسا — ابدأ بأشهر الأماكن بمدينتك</td></tr>';
      pins.clearLayers();
      list.forEach((p) => L.marker([p.lat, p.lng], { icon: MapKit.pickupIcon(p.name.slice(0, 18)) }).addTo(pins));
      rows.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!(await UI.confirm({ title: `حذف «${b.dataset.n}»؟`, confirmText: 'حذف', danger: true }))) return;
        if (await act(b, () => API.del(api('/pois/' + b.dataset.del)), 'انحذف')) A.route();
      });
    };
    draw(d.pois);
    if (d.pois.length) map.fitBounds(L.latLngBounds(d.pois.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
    let t; node.querySelector('[data-q]').oninput = (e) => {
      clearTimeout(t); t = setTimeout(async () => { try { draw((await API.get(api('/pois?q=' + encodeURIComponent(e.target.value)))).pois); } catch {} }, 250);
    };
    add.onclick = async () => {
      const body = { name: node.querySelector('[data-name]').value.trim(), category: node.querySelector('[data-cat]').value,
        address: node.querySelector('[data-addr]').value.trim() || undefined, ...picked };
      if (!body.name) return toast('اكتب اسم المكان', 'error');
      if (await act(add, () => API.post(api('/pois'), body), 'انضاف المكان — صار يطلع بالبحث')) A.route();
    };
  };

  /* ============================== صور السيارات ============================== */
  /**
   * أداة توحيد الصورة حسب الـ Style Bible:
   * بتلاقي حدود السيارة بالصورة (البكسلات الي مش أبيض/شفاف)، وبتحطها على لوحة 1200×800 بيضاء
   * بعرض 84% وبالنص، وأسفل العجلات عند 86% من الارتفاع — فكل السيارات بنفس الحجم والمكان.
   */
  function normalizeCar(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('الملف مش صورة'));
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        const px = x.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        const step = Math.max(1, Math.floor(Math.max(w, h) / 900));
        for (let y = 0; y < h; y += step) {
          for (let xx = 0; xx < w; xx += step) {
            const i = (y * w + xx) * 4;
            const a = px[i + 3];
            const white = px[i] > 236 && px[i + 1] > 236 && px[i + 2] > 236;
            if (a > 24 && !white) { if (xx < minX) minX = xx; if (xx > maxX) maxX = xx; if (y < minY) minY = y; if (y > maxY) maxY = y; }
          }
        }
        if (maxX < 0) return reject(new Error('ما قدرنا نلاقي السيارة بالصورة — لازم خلفية بيضاء أو شفافة'));
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const W = CarArt.W, H = CarArt.H;
        let scale = (W * CarArt.WIDTH) / bw;
        const maxH = H * CarArt.GROUND - H * 0.1;                    // ما تطلع فوق 10% من الأعلى
        if (bh * scale > maxH) scale = maxH / bh;
        const out = document.createElement('canvas'); out.width = W; out.height = H;
        const o = out.getContext('2d');
        o.fillStyle = '#FFFFFF'; o.fillRect(0, 0, W, H);
        o.imageSmoothingQuality = 'high';
        const dw = bw * scale, dh = bh * scale;
        o.drawImage(img, minX, minY, bw, bh, (W - dw) / 2, H * CarArt.GROUND - dh, dw, dh);
        resolve({ dataUrl: out.toDataURL('image/jpeg', 0.9), widthPct: Math.round((dw / W) * 100) });
      };
      const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.onerror = () => reject(new Error('تعذّر قراءة الملف')); r.readAsDataURL(file);
    });
  }

  P.cars = async (main) => {
    const [d, cat] = await Promise.all([API.get(api('/car-images')), API.vehicleCatalog()]);
    const node = render(main, `
      ${head('صور السيارات', 'ارفع صورة وحدة لكل فئة (سوناتا، كورولا…) وهي الي بيشوفها الزبون لما كابتن بهاي الفئة يقبل طلبه. اللون بيبين كدائرة ملوّنة مع اللوحة، فما بتحتاج صورة لكل لون.')}

      ${d.missing.length ? `<div class="panel panel--alert"><div class="panel__title"><h2>ناقص صور — سيارات كباتن شغّالين</h2>
        <span class="muted xs">الزبون بيشوفهم بدون صورة لحد ما ترفعها</span></div>
        <div class="chips-wrap">${d.missing.map((m) => `<button class="chip chip--warn" data-miss="${m.makeId}|${m.classId}">${esc(m.label)} <span class="muted-3">(${m.captains} كابتن)</span></button>`).join('')}</div></div>` : ''}

      <div class="panel"><div class="panel__title"><h2>رفع صورة لفئة</h2></div>
        <div class="form-grid">
          <div class="field-row"><label>الشركة</label><select class="in" data-make><option value="">اختار…</option>${cat.makes.map((m) => `<option value="${m.id}">${esc(m.ar)} · ${esc(m.en)}</option>`).join('')}</select></div>
          <div class="field-row"><label>الفئة</label><select class="in" data-class disabled><option value="">اختار الشركة أول</option></select></div>
          <label class="btn btn--primary" style="cursor:pointer">اختار صورة<input type="file" accept="image/png,image/jpeg,image/webp" data-file hidden></label>
        </div>
        <div class="sb-upload hidden" data-up>
          <div class="sb-frame"><div class="sb-guides"><i class="g-w"></i><i class="g-70"></i><i class="g-86"></i></div><img data-prev alt=""></div>
          <div><p class="sm" data-info></p>
            <p class="muted xs">وحّدنا الصورة على الإطار لحالها: عرض السيارة 84% وبالنص، وأسفل العجلات عند 86%. الخطوط الحمرا للتأكد بس.</p>
            <button class="btn btn--primary" data-save>حفظ الصورة</button></div>
        </div>
      </div>

      <div class="panel"><div class="panel__title"><h2>الإطار الثابت (Style Bible)</h2><span class="muted xs">عشان كل الصور تطلع متناسقة</span></div>
        <ul class="sb-list sb-list--wide">
          <li><b>الزاوية:</b> أمامية 3/4 ثابتة لكل السيارات (المقدمة لنفس الجهة دايماً، حوالي 30°)</li>
          <li><b>الكاميرا:</b> بارتفاع الكبوت تقريباً، عدسة 70–85mm، بدون ميلان</li>
          <li><b>الحجم:</b> عرض السيارة 82–86% من عرض الصورة، بالنص أفقياً (اللوحة بتضبطه لحالها)</li>
          <li><b>الخلفية:</b> بيضاء #FFFFFF أو شفافة (PNG)</li>
          <li><b>الإضاءة:</b> استوديو ناعمة، ظل ناعم تحت السيارة، شبابيك تظليل خفيف مش أسود</li>
          <li><b>لون الصورة:</b> أي لون — اللون الحقيقي للسيارة بيبين كدائرة بالبطاقة. الأفضل لون فاتح (أبيض/فضي)</li>
        </ul>
        <details class="sb-prompt"><summary>نص جاهز لتوليد صورة بالذكاء الاصطناعي (غيّر السطر الأول بس)</summary>
<pre data-prompt>[YEAR] [MAKE] [CLASS], white paint.
Studio product photo, front three-quarter view, car nose pointing to the right at about 30 degrees,
camera at hood height, zero roll, 80mm lens, no distortion.
Car centered horizontally, filling 84% of the image width, wheels touching the ground at 86% of image height.
Pure white #FFFFFF seamless background. Soft studio key light from top-front, gentle fill from the opposite side,
very subtle rim light from behind. Very soft contact shadow under the car only. Clear but soft reflections.
Lightly tinted windows (not black), all four wheels fully visible, real factory details of this exact model,
clean edges, high detail, no people, no text, no logos added, no license plate text, no props.
Aspect ratio 3:2, 1200x800.</pre>
          <button class="btn btn--ghost btn--sm" data-copy>نسخ النص</button></details>
      </div>

      <div class="panel"><div class="panel__title"><h2>المكتبة</h2><span class="muted xs">${d.images.length} فئة إلها صورة</span></div>
        <div class="car-lib">${d.images.map((i) => `<figure>
          <div class="car-art"><img src="${esc(i.url)}" alt=""></div>
          <figcaption><b>${esc(i.label)}</b><span>${i.captains ? i.captains + ' كابتن' : ''}</span>
          <button class="btn btn--ghost btn--sm" data-del="${i.id}">حذف</button></figcaption></figure>`).join('')
          || '<p class="muted sm">لسا ما في صور. ابدأ بالسيارات الأكثر عند كباتنك.</p>'}</div></div>`);

    const mk = node.querySelector('[data-make]'), cl = node.querySelector('[data-class]');
    mk.onchange = () => {
      const m = cat.makes.find((x) => x.id === mk.value);
      cl.disabled = !m;
      cl.innerHTML = m ? m.classes.map((c) => `<option value="${c.id}">${esc(c.ar)}${c.ar !== c.en ? ' · ' + esc(c.en) : ''}</option>`).join('') : '<option value="">اختار الشركة أول</option>';
    };
    node.querySelectorAll('[data-miss]').forEach((b) => b.onclick = () => {
      const [m, c] = b.dataset.miss.split('|');
      mk.value = m; mk.onchange(); cl.value = c;
      node.querySelector('[data-file]').click();
    });
    node.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(node.querySelector('[data-prompt]').textContent); toast('انسخ', 'success'); } catch {}
    };

    let ready = null;
    node.querySelector('[data-file]').onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        ready = await normalizeCar(f);
        node.querySelector('[data-up]').classList.remove('hidden');
        node.querySelector('[data-prev]').src = ready.dataUrl;
        node.querySelector('[data-info]').innerHTML = `عرض السيارة بالإطار: <b class="num">${ready.widthPct}%</b> ${ready.widthPct >= 82 && ready.widthPct <= 86 ? '✓ مضبوط' : '— تأكد إن الصورة بزاوية 3/4 وخلفية بيضاء'}`;
      } catch (x) { toast(x.message, 'error'); }
    };
    node.querySelector('[data-save]').onclick = async (e) => {
      if (!mk.value || !cl.value) return toast('اختار الشركة والفئة', 'error');
      if (!ready) return;
      if (await act(e.currentTarget, () => API.post(api('/car-images'), { makeId: mk.value, classId: cl.value, dataUrl: ready.dataUrl }), 'انحفظت — صارت تبين للزباين')) { A.refreshCounts(); A.route(); }
    };
    node.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!(await UI.confirm({ title: 'حذف الصورة؟', body: 'الزبون رح يشوف السيارة بدون صورة.', confirmText: 'حذف', danger: true }))) return;
      if (await act(b, () => API.del(api('/car-images/' + b.dataset.del)), 'انحذفت')) A.route();
    });
  };

  /* ================================ تنبيهات الإدارة ================================ */
  const ALERT_ICON = { car_image_missing: 'car2', default: 'bell' };
  P.alerts = async (main) => {
    const d = await API.get(api('/alerts'));
    const node = render(main, `
      ${head('التنبيهات', 'كل إشي محتاج انتباهك: سيارات بدون صور، وأي تنبيه جديد بنضيفه لاحقاً.',
        d.unread ? '<button class="btn btn--ghost" data-read-all>علّم الكل مقروء</button>' : '')}
      <div class="panel" data-push><div class="skeleton" style="height:40px"></div></div>
      <div class="panel panel--flush"><div class="table-wrap"><table class="t">
        <thead><tr><th>التنبيه</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>${d.alerts.map((a) => `<tr class="${a.read ? '' : 'row--new'}">
          <td><div style="display:flex;gap:10px;align-items:flex-start">
            <span style="color:${a.read ? 'var(--text-3)' : 'var(--brand-600)'}">${Icon(ALERT_ICON[a.type] || ALERT_ICON.default, 20)}</span>
            <span><b>${esc(a.title)}</b><div class="muted-cell" style="white-space:normal">${esc(a.body || '')}</div></span></div></td>
          <td class="muted-cell">${esc(A.when(a.createdAt))}</td>
          <td>${a.url && a.url.indexOf('/admin/#') === 0 ? `<a class="btn btn--ghost btn--sm" href="${esc(a.url.slice(7))}">افتح</a>` : ''}</td>
        </tr>`).join('') || '<tr><td class="empty-row" colspan="3">ما في تنبيهات</td></tr>'}</tbody></table></div></div>`);

    const readAll = node.querySelector('[data-read-all]');
    if (readAll) readAll.onclick = async () => { if (await act(readAll, () => API.post(api('/alerts/read'), {}), 'تم')) { A.refreshCounts(); A.route(); } };

    // تفعيل الإشعارات على تلفونك حتى توصلك التنبيهات وأنت برّا اللوحة
    const box = node.querySelector('[data-push]');
    const drawPush = async () => {
      const st = await PushKit.state();
      box.innerHTML = `<div class="row" style="display:flex;gap:12px;align-items:flex-start">
        <span style="color:${st === 'on' ? 'var(--success-500)' : 'var(--brand-600)'}">${Icon('bell', 22)}</span>
        <div style="flex:1"><b>${st === 'on' ? 'الإشعارات مفعّلة على هاد الجهاز' : 'فعّل الإشعارات'}</b>
          <p class="muted sm" style="margin:4px 0 0">${esc(PushKit.TEXT[st])}</p></div>
        ${st === 'off' ? '<button class="btn btn--primary" data-on>تفعيل</button>' : ''}
        ${st === 'on' ? '<button class="btn btn--ghost" data-test>جرّب</button>' : ''}</div>`;
      const on = box.querySelector('[data-on]');
      if (on) on.onclick = async () => { await act(on, () => PushKit.enable(), 'تم'); drawPush(); };
      const t = box.querySelector('[data-test]');
      if (t) t.onclick = () => act(t, () => API.post('/api/push/test', { app: 'admin' }), 'انبعت');
    };
    drawPush();
  };
})();
