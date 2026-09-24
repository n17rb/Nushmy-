/* ==========================================================
   Inbox — الإشعارات، الدعم الفني، محادثة الرحلة، الإبلاغ والأغراض المنسية.
   مشترك بين تطبيق الزبون (as='customer') وتطبيق الكابتن (as='captain').
   ========================================================== */
window.Inbox = (function () {
  const { el, esc, show, toast, busy } = UI;

  const topbar = (title) => `
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
      <div class="topbar__title">${esc(title)}</div>
      <span style="width:44px"></span>
    </div>`;

  const TOPIC_ICON = { general: 'help', lost_item: 'search', report_captain: 'flag', report_rider: 'flag', trip_issue: 'car', payment: 'wallet', account: 'user', captain_admin: 'shield', trip: 'chat' };
  const CUSTOMER_TOPICS = [
    ['general', 'استفسار عام', 'أي سؤال أو اقتراح'],
    ['lost_item', 'نسيت غرض بالسيارة', 'منوصّلك بالكابتن ومنرجعلك إياه'],
    ['report_captain', 'إبلاغ عن كابتن', 'سلوك، قيادة، أجرة زيادة…'],
    ['trip_issue', 'مشكلة برحلة', 'مسار غلط، تأخير، إلغاء…'],
    ['payment', 'الأجرة والدفع', 'استفسار عن مبلغ'],
    ['account', 'حسابي', 'الدخول، الرقم، حذف الحساب'],
  ];
  const CAPTAIN_TOPICS = [
    ['general', 'استفسار عام', 'أي سؤال للإدارة'],
    ['payment', 'المحفظة والعمولة', 'شحن، رصيد، خصومات'],
    ['report_rider', 'إبلاغ عن زبون', 'سلوك أو مشكلة برحلة'],
    ['trip_issue', 'مشكلة برحلة', 'إلغاء، أجرة، مسار'],
    ['lost_item', 'غرض منسي بسيارتي', 'زبون نسي إشي عندك'],
    ['account', 'حسابي والوثائق', 'التفعيل، الوثائق، السيارة'],
  ];
  const REPORT_REASONS = ['قيادة متهورة أو سرعة', 'سلوك غير لائق', 'طلب أجرة أكثر من التطبيق', 'السيارة أو اللوحة مختلفة',
    'كان عالتلفون وهو سايق', 'ما وصل للمكان الصح', 'السيارة مش نظيفة', 'غير ذلك'];

  /* ------------------------------ الإشعارات ------------------------------ */
  function notifications({ as = 'customer', back }) {
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('الإشعارات')}
        <div class="pad-x">
          <div class="card push-card" data-push><div class="skeleton" style="height:40px"></div></div>
          <div data-list style="margin-top:var(--s-4)">
            <div class="skeleton" style="height:72px;margin-bottom:var(--s-3)"></div>
            <div class="skeleton" style="height:72px"></div>
          </div>
        </div>
      </section>`);
    node.querySelector('[data-back]').onclick = back;

    async function pushCard() {
      const box = node.querySelector('[data-push]');
      const st = await PushKit.state();
      box.innerHTML = `
        <div class="row" style="align-items:flex-start;gap:var(--s-3)">
          <span style="color:${st === 'on' ? 'var(--success-500)' : 'var(--brand-600)'}">${Icon('bell', 24)}</span>
          <div class="grow">
            <div class="bold">${st === 'on' ? 'الإشعارات مفعّلة' : 'فعّل الإشعارات'}</div>
            <p class="sm muted" style="margin:4px 0 0">${esc(PushKit.TEXT[st])}</p>
          </div>
        </div>
        ${st === 'off' ? '<button class="btn btn--primary btn--sm" style="margin-top:var(--s-3);width:100%" data-enable>تفعيل الإشعارات</button>' : ''}
        ${st === 'on' ? '<button class="btn btn--ghost btn--sm" style="margin-top:var(--s-3);width:100%" data-test>جرّب إشعار</button>' : ''}`;
      const en = box.querySelector('[data-enable]');
      if (en) en.onclick = async () => {
        busy(en, true);
        try { const r = await PushKit.enable(); if (r === 'on') toast('تم تفعيل الإشعارات', 'success'); } catch (e) { toast(e.message, 'error'); }
        pushCard();
      };
      const t = box.querySelector('[data-test]');
      if (t) t.onclick = async () => {
        try { const r = await API.pushTest(as); toast(r.delivered ? 'انبعت — شوف أعلى الشاشة' : 'ما وصل لأي جهاز. جرّب تفعّل من جديد'); } catch (e) { toast(e.message, 'error'); }
      };
    }
    pushCard();

    (async () => {
      const box = node.querySelector('[data-list]');
      try {
        const { notifications: list } = await API.notifications(as);
        if (!list.length) {
          box.innerHTML = `<div class="empty"><div class="empty__icon">${Icon('bell', 64)}</div><p class="bold">ما في إشعارات بعد</p>
            <p class="sm">العروض والأكواد وردود الدعم رح تظهر هون وتضل محفوظة</p></div>`;
          return;
        }
        box.innerHTML = `<div class="list">${list.map((n) => `
          <div class="list-item notif ${n.read ? '' : 'notif--new'}" ${n.data && n.data.threadId ? `data-thread="${esc(n.data.threadId)}"` : ''}>
            <span class="list-item__icon ${n.type === 'promo' ? 'list-item__icon--brand' : ''}">${Icon(n.type === 'promo' ? 'star' : n.type === 'support' ? 'chat' : 'bell', 20)}</span>
            <span class="list-item__body">
              <span class="list-item__title">${esc(n.title)}</span>
              <span class="list-item__sub" style="white-space:normal">${esc(n.body || '')}</span>
              ${n.data && n.data.code ? `<button class="promo-code" data-code="${esc(n.data.code)}"><span class="num">${esc(n.data.code)}</span> · نسخ الكود</button>` : ''}
              <span class="xs muted-3">${esc(UI.dateText(n.createdAt))}</span>
            </span>
            ${n.read ? '' : '<span class="dot-new" aria-label="جديد"></span>'}
          </div>`).join('')}</div>`;
        box.querySelectorAll('[data-code]').forEach((b) => b.onclick = async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(b.dataset.code); toast('تم نسخ الكود ' + b.dataset.code, 'success'); } catch { toast(b.dataset.code); }
        });
        box.querySelectorAll('[data-thread]').forEach((b) => b.onclick = () => show(supportThread({ id: b.dataset.thread, as, back: () => show(notifications({ as, back })) })));
        // انقرت ← بتصير مقروءة، بس بتضل موجودة بالقائمة
        API.readNotifications(as).catch(() => {});
      } catch (e) { box.innerHTML = `<p class="sm muted-3">${esc(e.message)}</p>`; }
    })();
    return node;
  }

  /* ------------------------------ الدعم الفني ------------------------------ */
  function support({ as = 'customer', back }) {
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('الدعم الفني')}
        <div class="pad-x">
          <button class="btn btn--primary" data-new>${Icon('chat', 18)} محادثة جديدة مع الدعم</button>
          <p class="sm muted-3" style="margin:var(--s-3) 0 var(--s-5);text-align:center">فريق نشمي بيرد عليك هون، وبيوصلك إشعار لما يرد.</p>
          <div data-list><div class="skeleton" style="height:72px"></div></div>
        </div>
      </section>`);
    const self = () => show(support({ as, back }));
    node.querySelector('[data-back]').onclick = back;
    node.querySelector('[data-new]').onclick = () => show(supportNew({ as, back: self }));
    (async () => {
      const box = node.querySelector('[data-list]');
      try {
        const { threads } = await API.chat.threads(as);
        const list = threads.filter((t) => t.kind === 'support' || t.lastMessageAt);
        if (!list.length) { box.innerHTML = `<div class="empty"><div class="empty__icon">${Icon('chat', 60)}</div><p class="sm">ما في محادثات سابقة</p></div>`; return; }
        box.innerHTML = `<div class="list">${list.map((t) => `
          <button class="list-item" data-id="${esc(t.id)}" data-kind="${esc(t.kind)}" data-trip="${esc(t.trip ? t.trip.id : '')}">
            <span class="list-item__icon has-badge">${Icon(TOPIC_ICON[t.topic] || 'chat', 20)}${ChatUI.badge(t.unread)}</span>
            <span class="list-item__body">
              <span class="list-item__title">${esc(t.kind === 'trip' ? 'محادثة ' + (t.peer ? t.peer.name : 'الرحلة') : t.topicLabel)}${t.trip ? ` <span class="tag num">${esc(t.trip.code)}</span>` : ''}</span>
              <span class="list-item__sub">${esc(t.lastPreview || '')}</span>
            </span>
            <span class="list-item__end xs muted-3">${t.lastMessageAt ? esc(UI.dateText(t.lastMessageAt)) : ''}${t.status === 'CLOSED' ? '<br>مغلقة' : ''}</span>
          </button>`).join('')}</div>`;
        box.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => {
          if (b.dataset.kind === 'trip') show(tripChat({ tripId: b.dataset.trip, as, back: self }));
          else show(supportThread({ id: b.dataset.id, as, back: self }));
        });
      } catch (e) { box.innerHTML = `<p class="sm muted-3">${esc(e.message)}</p>`; }
    })();
    return node;
  }

  /** رسالة جديدة للدعم — topic وtripId اختياريين (من شاشة الرحلة) */
  function supportNew({ as = 'customer', back, topic = null, trip = null }) {
    const topics = as === 'captain' ? CAPTAIN_TOPICS : CUSTOMER_TOPICS;
    let chosen = topic || null;
    const placeholder = {
      lost_item: 'شو الغرض؟ لونه وشكله ووين كان بالسيارة (قدام/ورا)…',
      report_captain: 'احكيلنا شو صار بالتفصيل…',
      trip_issue: 'شو المشكلة بالرحلة؟',
    };
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar(topic === 'lost_item' ? 'نسيت غرض بالسيارة' : topic === 'report_captain' ? 'إبلاغ عن الكابتن' : 'رسالة للدعم')}
        <div class="pad-x">
          ${trip ? `<div class="card row sm" style="gap:var(--s-3);margin-bottom:var(--s-4)">${Icon('receipt', 20)}
            <span class="grow" style="min-width:0"><span class="bold">رحلة <span class="num">${esc(trip.code || '')}</span></span>
            <span class="muted-3" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(trip.destAddress || trip.to || '')}</span></span></div>` : ''}
          ${topic ? '' : `<div class="field"><span class="field__label">الموضوع</span>
            <div class="list" data-topics>${topics.map(([k, t, d]) => `
              <button class="list-item" data-t="${k}">
                <span class="list-item__icon">${Icon(TOPIC_ICON[k] || 'help', 20)}</span>
                <span class="list-item__body"><span class="list-item__title">${esc(t)}</span><span class="list-item__sub">${esc(d)}</span></span>
                <span class="list-item__end" data-check></span>
              </button>`).join('')}</div></div>`}
          ${topic === 'report_captain' ? `<div class="field"><span class="field__label">السبب</span>
            <div class="chips-wrap" data-reasons>${REPORT_REASONS.map((r) => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>` : ''}
          <label class="field"><span class="field__label">رسالتك</span>
            <textarea class="input" data-body rows="5" maxlength="1000" style="min-height:130px;padding-top:12px;resize:vertical"
              placeholder="${esc(placeholder[topic] || 'اكتب رسالتك هون…')}"></textarea></label>
          ${topic === 'lost_item' ? `<p class="sm muted-3" style="margin-top:-6px">منبعث للكابتن فوراً ومنرتّب معك كيف يرجعلك الغرض.</p>` : ''}
          ${topic === 'report_captain' ? `<p class="sm muted-3" style="margin-top:-6px">بلاغك سرّي — الكابتن ما بيعرف مين بلّغ.</p>` : ''}
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-send>إرسال</button>
        </div>
      </section>`);
    node.querySelector('[data-back]').onclick = back;
    const reasons = new Set();
    node.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
      chosen = b.dataset.t;
      node.querySelectorAll('[data-t]').forEach((x) => {
        x.querySelector('[data-check]').innerHTML = x === b ? `<span style="color:var(--brand-600)">${Icon('checkCircle', 22)}</span>` : '';
        x.querySelector('.list-item__icon').classList.toggle('list-item__icon--brand', x === b);
      });
    });
    node.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => {
      const r = b.dataset.r;
      if (reasons.has(r)) { reasons.delete(r); b.classList.remove('chip--brand'); } else { reasons.add(r); b.classList.add('chip--brand'); }
    });
    node.querySelector('[data-send]').onclick = async (ev) => {
      const btn = ev.currentTarget;
      let body = node.querySelector('[data-body]').value.trim();
      if (reasons.size) body = `السبب: ${[...reasons].join('، ')}${body ? '\n' + body : ''}`;
      if (!chosen) return toast('اختار الموضوع', 'error');
      if (!body) return toast('اكتب رسالتك', 'error');
      busy(btn, true, 'جاري الإرسال');
      try {
        const r = await API.chat.support({ as, topic: chosen, tripId: trip ? trip.id : undefined, body });
        toast('وصلت رسالتك للدعم ✓', 'success');
        show(supportThread({ id: r.thread.id, as, back }));
      } catch (e) { toast(e.message, 'error'); busy(btn, false); }
    };
    return node;
  }

  function supportThread({ id, as = 'customer', back }) {
    return ChatUI.screen({
      title: 'الدعم الفني', subtitle: 'فريق نشمي', showNames: true, onBack: back,
      load: (after) => API.chat.get(id, as, after),
      send: (body) => API.chat.send(id, body, as),
      onThread: (t, node) => {
        node.querySelector('[data-title]').textContent = t.topicLabel || 'الدعم الفني';
        node.querySelector('[data-sub]').textContent = t.trip ? 'رحلة ' + t.trip.code : 'فريق نشمي';
      },
    });
  }

  /** محادثة الرحلة: الزبون ↔ الكابتن (بدون أرقام تلفونات) */
  function tripChat({ tripId, as = 'customer', back, peerName }) {
    let threadId = null;
    const quick = as === 'captain'
      ? ['أنا بالطريق 🚗', 'وصلت، أنا قدام المكان', 'وين بالضبط؟', 'دقيقتين وبكون عندك']
      : ['أنا نازل هلأ', 'أنا قدام الباب', 'استناني دقيقة لو سمحت', 'وين أنت بالضبط؟'];
    return ChatUI.screen({
      title: peerName || (as === 'captain' ? 'الزبون' : 'الكابتن'), subtitle: 'محادثة الرحلة', quick, onBack: back,
      emptyText: as === 'captain' ? 'احكي مع الزبون بدون ما تتصل' : 'احكي مع الكابتن — رقمك ما بيبين',
      load: async (after) => {
        if (!threadId) { const r = await API.chat.trip(tripId, as); threadId = r.thread.id; return r; }
        return API.chat.get(threadId, as, after);
      },
      send: (body) => API.chat.send(threadId, body, as),
      onThread: (t, node) => { if (t.peer) node.querySelector('[data-title]').textContent = t.peer.name; },
    });
  }

  /** تفاصيل رحلة سابقة (للزبون): نسيت غرض، إبلاغ، مشكلة */
  function tripDetail({ trip, back }) {
    const t = trip;
    const node = el(`
      <section class="screen screen--scroll">
        ${topbar('تفاصيل الرحلة')}
        <div class="pad-x">
          <div class="card">
            <div class="row" style="margin-bottom:var(--s-3)">
              <span class="chip ${t.status === 'TRIP_COMPLETED' ? 'chip--success' : ''}">${esc(t.statusLabel)}</span>
              <div class="spacer"></div><span class="sm muted-3 num">${esc(t.code || '')}</span>
            </div>
            <div class="route-line">
              <div class="route-line__rail"><span class="route-line__dot"></span><span class="route-line__bar"></span><span class="route-line__dot route-line__dot--end"></span></div>
              <div class="route-line__labels">
                <div class="sm"><div class="muted-3 xs">من</div><div class="bold">${esc(t.pickupAddress || '—')}</div></div>
                <div class="sm"><div class="muted-3 xs">إلى</div><div class="bold">${esc(t.destAddress || '—')}</div></div>
              </div>
            </div>
            <div class="row sm" style="justify-content:space-between;margin-top:var(--s-4);padding-top:var(--s-3);border-top:1px solid var(--border)">
              <span class="muted">${esc(UI.dateText(t.requestedAt))}</span>
              <span class="bold"><span class="num">${esc(t.fareText)}</span> د.أ</span>
            </div>
          </div>

          <h3 class="h3" style="margin:var(--s-6) 0 var(--s-2)">بدك مساعدة بهاي الرحلة؟</h3>
          <div class="list">
            <button class="list-item" data-lost>
              <span class="list-item__icon list-item__icon--brand">${Icon('search', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">نسيت غرض بالسيارة</span>
              <span class="list-item__sub">منوصّل الكابتن ومنرجعلك غرضك</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span></button>
            <button class="list-item" data-report>
              <span class="list-item__icon">${Icon('flag', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">إبلاغ عن الكابتن</span>
              <span class="list-item__sub">بلاغك سرّي</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span></button>
            <button class="list-item" data-issue>
              <span class="list-item__icon">${Icon('alert', 20)}</span>
              <span class="list-item__body"><span class="list-item__title">مشكلة بالأجرة أو المسار</span></span>
              <span class="list-item__end">${Icon('forward', 18)}</span></button>
          </div>
        </div>
      </section>`);
    const self = () => show(tripDetail({ trip, back }));
    node.querySelector('[data-back]').onclick = back;
    node.querySelector('[data-lost]').onclick = () => show(supportNew({ topic: 'lost_item', trip, back: self }));
    node.querySelector('[data-report]').onclick = () => show(supportNew({ topic: 'report_captain', trip, back: self }));
    node.querySelector('[data-issue]').onclick = () => show(supportNew({ topic: 'trip_issue', trip, back: self }));
    return node;
  }

  /** عدّاد غير المقروء (رسائل الدعم + الإشعارات) لنقاط الأيقونات */
  async function counts(as = 'customer') {
    try { return await API.chat.unread(as); } catch { return { support: 0, trips: {}, notifications: 0 }; }
  }

  return { notifications, support, supportNew, supportThread, tripChat, tripDetail, counts, REPORT_REASONS };
})();
