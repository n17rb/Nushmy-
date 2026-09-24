/* ==========================================================
   ChatUI — شاشة محادثة مشتركة (الزبون ↔ الكابتن، والدعم الفني)
   بتتحدّث كل 4 ثواني وهي مفتوحة، ورسائلك بتطلع فوراً.
   ========================================================== */
window.ChatUI = (function () {
  const { el, esc } = UI;

  const ROLE_NAME = { admin: 'فريق نشمي', system: 'نشمي', customer: 'الزبون', captain: 'الكابتن' };

  function timeText(iso) {
    try { return new Date(iso).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  }
  function dayText(iso) {
    const d = new Date(iso), t = new Date();
    if (d.toDateString() === t.toDateString()) return 'اليوم';
    if (new Date(t - 86400000).toDateString() === d.toDateString()) return 'أمس';
    return d.toLocaleDateString('ar-JO', { day: 'numeric', month: 'long' });
  }
  /** الروابط والأرقام الطويلة بتنعرض عادي — منمنع أي HTML */
  const bodyHtml = (s) => esc(s).replace(/\n/g, '<br>');

  function bubble(m, { showName }) {
    const cls = m.mine ? 'msg--me' : m.senderRole === 'system' ? 'msg--sys' : 'msg--them';
    return `<div class="msg ${cls}" data-id="${esc(m.id)}">
      ${showName && !m.mine && m.senderRole !== 'system' ? `<div class="msg__who">${esc(ROLE_NAME[m.senderRole] || '')}</div>` : ''}
      <div class="msg__body">${bodyHtml(m.body)}</div>
      <div class="msg__time">${esc(timeText(m.createdAt))}${m.pending ? ' · …' : ''}</div>
    </div>`;
  }

  /**
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.subtitle]
   * @param {string} [o.head]        HTML فوق الرسائل (بطاقة الرحلة مثلاً)
   * @param {string[]} [o.quick]     ردود جاهزة
   * @param {Function} o.load        (after) => {thread, messages}
   * @param {Function} o.send        (body) => {message}
   * @param {Function} o.onBack
   * @param {boolean} [o.showNames]  اسم المرسل فوق الفقاعة (للدعم)
   */
  function screen(o) {
    const node = el(`
      <section class="screen chat">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
          <div class="grow" style="min-width:0;text-align:center">
            <div class="topbar__title" style="font-size:17px" data-title>${esc(o.title || 'محادثة')}</div>
            <div class="xs muted-3" data-sub>${esc(o.subtitle || '')}</div>
          </div>
          <span style="width:44px"></span>
        </div>
        <div class="chat__scroll" data-scroll>
          ${o.head || ''}
          <div class="chat__list" data-list><div class="skeleton" style="height:48px;width:60%;margin:var(--s-3) 0"></div></div>
        </div>
        ${o.quick && o.quick.length ? `<div class="chat__quick" data-quick>${o.quick.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
        <form class="chat__bar" data-form>
          <textarea class="chat__input" data-input rows="1" maxlength="1000" placeholder="اكتب رسالتك…" enterkeyhint="send"></textarea>
          <button class="chat__send" type="submit" aria-label="إرسال">${Icon('forward', 22)}</button>
        </form>
        <div class="chat__locked hidden" data-locked>المحادثة انقفلت بعد نهاية الرحلة. لأي شي، راسل الدعم الفني.</div>
      </section>`);

    const list = node.querySelector('[data-list]');
    const scroll = node.querySelector('[data-scroll]');
    const input = node.querySelector('[data-input]');
    const form = node.querySelector('[data-form]');
    let msgs = [], last = null, timer = null, first = true;

    node.querySelector('[data-back]').onclick = () => { stop(); o.onBack && o.onBack(); };
    const stop = () => { clearInterval(timer); timer = null; };
    UI.onLeave(node, stop);

    const atBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    function render(stick) {
      if (!msgs.length) {
        list.innerHTML = `<div class="empty" style="padding-block:var(--s-6)"><div class="empty__icon">${Icon('chat', 56)}</div>
          <p class="sm">${esc(o.emptyText || 'ابدأ المحادثة — الرسائل بتوصل فوراً')}</p></div>`;
        return;
      }
      let html = '', lastDay = '';
      for (const m of msgs) {
        const d = dayText(m.createdAt);
        if (d !== lastDay) { html += `<div class="chat__day">${esc(d)}</div>`; lastDay = d; }
        html += bubble(m, { showName: o.showNames });
      }
      list.innerHTML = html;
      if (stick) scroll.scrollTop = scroll.scrollHeight;
    }

    let mounted = false;
    async function refresh() {
      if (node.isConnected) mounted = true;
      else if (mounted) return stop();      // الشاشة انسكرت
      try {
        const r = await o.load(first ? null : last);
        if (r.thread) {
          if (r.thread.locked) { form.classList.add('hidden'); node.querySelector('[data-locked]').classList.remove('hidden'); const qk = node.querySelector('[data-quick]'); if (qk) qk.classList.add('hidden'); }
          if (o.onThread) o.onThread(r.thread, node);
        }
        const stick = first || atBottom();
        if (first) msgs = r.messages || [];
        else {
          const known = new Set(msgs.map((m) => m.id));
          for (const m of r.messages || []) if (!known.has(m.id)) msgs.push(m);
        }
        msgs = msgs.filter((m) => !m.pending || !(r.messages || []).some((x) => x.body === m.body && x.mine));
        if (msgs.length) last = msgs.filter((m) => !m.pending).map((m) => m.createdAt).sort().pop() || last;
        first = false;
        render(stick);
      } catch (e) {
        if (first) list.innerHTML = `<p class="sm muted-3 pad">${esc(e.message)}</p>`;
      }
    }

    async function send(text) {
      text = String(text || '').trim();
      if (!text) return;
      const tmp = { id: 'tmp' + Date.now(), body: text, mine: true, pending: true, createdAt: new Date().toISOString(), senderRole: 'me' };
      msgs.push(tmp); render(true);
      try {
        const r = await o.send(text);
        const i = msgs.indexOf(tmp);
        if (i >= 0) msgs[i] = { ...r.message, mine: true };
        last = r.message.createdAt > (last || '') ? r.message.createdAt : last;
        render(true);
      } catch (e) {
        msgs = msgs.filter((m) => m !== tmp); render(true);
        input.value = text;
        UI.toast(e.message, 'error');
      }
    }

    form.onsubmit = (e) => { e.preventDefault(); const t = input.value; input.value = ''; autosize(); send(t); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); form.requestSubmit(); }
    });
    const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
    input.addEventListener('input', autosize);
    node.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => send(b.dataset.q); });

    setTimeout(refresh, 0);                  // بعد ما الشاشة تنعرض
    timer = setInterval(refresh, o.pollMs || 4000);
    return node;
  }

  /** نقطة حمراء بعدد غير المقروء */
  const badge = (n) => (n > 0 ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : '');

  return { screen, badge, timeText };
})();
