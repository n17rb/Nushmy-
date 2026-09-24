/* شاشات الدخول: رقم الهاتف → رمز التحقق → استكمال الحساب */
window.Screens = window.Screens || {};

(function () {
  const { el, esc, show, toast, busy } = UI;

  const JO_FLAG = `<svg viewBox="0 0 60 40" width="34" height="34" preserveAspectRatio="xMidYMid slice">
    <rect width="60" height="13.33" y="0" fill="#000"/><rect width="60" height="13.34" y="13.33" fill="#fff"/>
    <rect width="60" height="13.33" y="26.67" fill="#007A3D"/><path d="M0 0l30 20L0 40z" fill="#CE1126"/>
    <path d="M11.5 20l1.1 3.3 3.5.1-2.8 2.1 1 3.3-2.8-2-2.8 2 1-3.3-2.8-2.1 3.5-.1z" fill="#fff" transform="translate(0,-6) scale(.9) translate(1,0)"/>
  </svg>`;

  /* ---------------------- طلب دخول بواتساب معلّق (بعد الرجوع من واتساب) ---------------------- */
  const WA_KEY = 'nashmi-wa-pending';
  const waPending = {
    get() {
      try { const p = JSON.parse(sessionStorage.getItem(WA_KEY) || 'null'); return p && p.expiresAt > Date.now() ? p : null; }
      catch { return null; }
    },
    set(p) { try { sessionStorage.setItem(WA_KEY, JSON.stringify(p)); } catch {} },
    clear() { try { sessionStorage.removeItem(WA_KEY); } catch {} },
  };
  const waLoginMode = () => Boolean(App.config && App.config.loginMode === 'wa_link');

  /* ----------------------------- رقم الهاتف ----------------------------- */
  Screens.phone = function phoneScreen() {
    // إذا الزبون طلع لواتساب ورجع والصفحة انعادت، بنكمل من وين وقف
    const pending = waLoginMode() && waPending.get();
    if (pending) return Screens.waLogin(pending);

    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
        </div>
        <div class="pad-x" style="padding-top:var(--s-6)">
          <h1 class="display">دخّل رقم تلفونك</h1>
          <p class="muted" style="font-size:18px;margin:var(--s-2) 0 var(--s-8)">${waLoginMode() ? 'رح نأكد رقمك برسالة واتساب وحدة' : 'رايحين نرسل ألك رمز، دخّله'}</p>

          <label class="phone-field" for="phoneInput">
            <span class="phone-field__flag">${JO_FLAG}</span>
            <span class="phone-field__cc">+962</span>
            <input id="phoneInput" type="tel" inputmode="numeric" autocomplete="tel-national"
                   placeholder="7 9999 9999" maxlength="12">
          </label>
          <p class="field__error hidden" data-err></p>
          <p class="sm muted-3" style="margin-top:var(--s-4);line-height:1.7">
            بمتابعتك أنت موافق على شروط استخدام نشمي وسياسة الخصوصية.
          </p>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-send disabled>${waLoginMode() ? 'التالي' : 'أرسل الرمز'}</button>
        </div>
      </section>`);

    const input = node.querySelector('#phoneInput');
    const btn = node.querySelector('[data-send]');
    const err = node.querySelector('[data-err]');
    node.querySelector('[data-back]').onclick = () => App.go('welcome');

    const clean = (v) => v.replace(/\D/g, '').replace(/^962/, '').replace(/^0/, '').slice(0, 9);
    const pretty = (d) => (d.length > 5 ? `${d.slice(0, 1)} ${d.slice(1, 5)} ${d.slice(5)}` : d.length > 1 ? `${d.slice(0, 1)} ${d.slice(1)}` : d);

    input.addEventListener('input', () => {
      const d = clean(input.value);
      input.value = pretty(d);
      btn.disabled = d.length !== 9;
      err.classList.add('hidden');
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });

    btn.onclick = async () => {
      const phone = '0' + clean(input.value);
      busy(btn, true, 'جاري الإرسال');
      try {
        if (waLoginMode()) {
          const r = await API.post('/api/auth/wa/start', { phone }, { auth: false });
          const p = { ...r, display: input.value, expiresAt: Date.now() + r.expiresInSec * 1000 };
          waPending.set(p);
          show(Screens.waLogin(p));
          return;
        }
        const res = await API.requestOtp(phone);
        show(Screens.otp({ phone: res.phone, display: input.value, resendAfterSec: res.resendAfterSec, devCode: res.devCode, channel: res.channel, notice: res.notice }));
      } catch (e) {
        err.textContent = e.message; err.classList.remove('hidden');
      } finally { busy(btn, false); }
    };

    setTimeout(() => input.focus(), 220);
    return node;
  };

  /* ----------------------------- الدخول بواتساب ----------------------------- */
  const prettyIntl = (n) => `+${n.slice(0, 3)} ${n.slice(3, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;

  Screens.waLogin = function waLoginScreen(p) {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
        </div>
        <div class="pad-x" style="padding-top:var(--s-4)">
          <h1 class="display">أكّد رقمك بواتساب</h1>
          <p class="muted" style="font-size:17px;margin:var(--s-2) 0 var(--s-6);line-height:1.7">
            اكبس الزر، بيفتح واتساب والرسالة جاهزة لرقم نشمي. <b style="color:var(--text)">بس اكبس إرسال</b> وارجع هون.
          </p>
          <a class="btn btn--wa" href="${esc(p.link)}" target="_blank" rel="noopener" data-open>
            ${Icon('chat', 22)}<span>افتح واتساب وأرسل</span>
          </a>
          <p class="wa-wait" data-state aria-live="polite"><span class="wa-dot"></span><span data-state-text>بانتظار رسالتك…</span></p>

          ${App.config && App.config.smsFallback ? `<button class="btn btn--ghost" data-sms style="margin-bottom:var(--s-4)">ما عندي واتساب — ابعتلي الرمز برسالة SMS</button>` : ''}
          <div class="card wa-card">
            <div class="sm muted">ما انفتح واتساب؟ ابعت هاد الرمز برسالة لرقم نشمي:</div>
            <div class="wa-row"><span class="wa-code num">${esc(p.code)}</span><button class="btn btn--sm btn--ghost" data-copy="${esc(p.code)}">نسخ</button></div>
            <div class="wa-row"><bdi dir="ltr" class="num bold">${esc(prettyIntl(p.number))}</bdi><button class="btn btn--sm btn--ghost" data-copy="+${esc(p.number)}">نسخ</button></div>
            <div class="xs muted-3">لازم تبعتها من نفس الرقم الي كتبته: <bdi dir="ltr" class="num">+962 ${esc(p.display || '')}</bdi></div>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--ghost" data-change>غيّر الرقم</button>
        </div>
      </section>`);

    const stateEl = node.querySelector('[data-state]');
    const stateText = node.querySelector('[data-state-text]');
    let stopped = false, busyPoll = false;
    const leave = () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
    const restart = () => { leave(); waPending.clear(); show(Screens.phone()); };
    node.querySelector('[data-back]').onclick = restart;
    node.querySelector('[data-change]').onclick = restart;
    const smsBtn = node.querySelector('[data-sms]');
    if (smsBtn) smsBtn.onclick = async () => {
      busy(smsBtn, true, 'جاري الإرسال');
      try {
        const res = await API.requestOtp(p.phone, 'sms');
        leave(); waPending.clear();
        show(Screens.otp({ phone: res.phone, display: p.display, resendAfterSec: res.resendAfterSec, devCode: res.devCode, channel: res.channel, notice: res.notice, via: 'sms' }));
      } catch (e) { toast(e.message, 'error'); busy(smsBtn, false); }
    };
    node.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-copy]'); if (!c) return;
      try { await navigator.clipboard.writeText(c.dataset.copy); toast('انسخ ✓', 'success'); } catch { toast(c.dataset.copy); }
    });

    function expired() {
      leave(); waPending.clear();
      stateEl.classList.add('is-expired');
      stateText.textContent = 'انتهت صلاحية الطلب.';
      const again = el('<button class="btn btn--primary" style="margin-top:var(--s-4)">اطلب رمز جديد</button>');
      stateEl.after(again);
      node.querySelector('[data-open]').classList.add('hidden');
      again.onclick = async () => {
        busy(again, true);
        try {
          const r = await API.post('/api/auth/wa/start', { phone: p.phone }, { auth: false });
          const np = { ...r, display: p.display, expiresAt: Date.now() + r.expiresInSec * 1000 };
          waPending.set(np); show(Screens.waLogin(np));
        } catch (err) { toast(err.message, 'error'); busy(again, false); }
      };
    }

    async function poll() {
      if (stopped || busyPoll) return;
      if (Date.now() > p.expiresAt) return expired();
      busyPoll = true;
      try {
        const res = await API.post('/api/auth/wa/check', { id: p.id }, { auth: false });
        if (res.accessToken) {
          leave(); waPending.clear();
          stateEl.classList.add('is-ok'); stateText.textContent = 'تم التأكيد ✓';
          API.setToken(res.accessToken);
          App.setUser(res.user);
          if (!res.user.profileComplete && !App.skipProfileStep) show(Screens.completeProfile());
          else App.go('home');
        } else if (res.status === 'EXPIRED' || res.status === 'USED') expired();
      } catch (e) {
        if (e.code === 'WA_NOT_FOUND') expired();
      } finally { busyPoll = false; }
    }
    const timer = setInterval(poll, 2500);
    const onVis = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVis);
    UI.onLeave(node, leave);
    return node;
  };

  /* ----------------------------- رمز التحقق ----------------------------- */
  Screens.otp = function otpScreen({ phone, display, resendAfterSec, devCode, channel, notice, via }) {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="topbar">
          <button class="icon-btn" data-back aria-label="رجوع">${Icon('back', 22)}</button>
        </div>
        <div class="pad-x" style="padding-top:var(--s-6)">
          <h1 class="display">دخّل الرمز</h1>
          <p class="muted" style="font-size:17px;margin:var(--s-2) 0 var(--s-7)">
            ${channel === 'whatsapp' ? `أرسلنا رمزاً من 4 أرقام على <b style="color:#1FA855">واتساب</b> إلى` : channel === 'sms' ? 'أرسلنا رمزاً من 4 أرقام <b>برسالة نصية</b> إلى' : 'أرسلنا رمزاً من 4 أرقام إلى'}
            <span class="num bold" style="color:var(--text)">+962 ${esc(display || '')}</span>
          </p>
          <div class="otp" data-otp>
            ${[0, 1, 2, 3].map(() => '<input type="tel" inputmode="numeric" maxlength="1" autocomplete="one-time-code">').join('')}
          </div>
          <p class="field__error hidden" style="text-align:center" data-err></p>
          ${devCode ? `<div class="card" style="margin-top:var(--s-6);background:var(--warning-100);border-color:transparent">
              <div class="row" style="align-items:flex-start">
                <span style="color:var(--warning-500)">${Icon('alert', 20)}</span>
                <div class="sm">
                  <b>وضع التطوير:</b> الرمز هو <span class="num bold" style="font-size:17px">${esc(devCode)}</span>.
                  ${notice ? `ما قدرنا نبعته على واتساب: ${esc(notice)}.` : 'لما يشتغل واتساب بيوصل الرمز هناك وما بيظهر هون.'}
                </div>
              </div>
            </div>` : ''}
          <div style="text-align:center;margin-top:var(--s-6)">
            <button class="btn btn--sm btn--ghost" data-resend disabled>إعادة الإرسال</button>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-verify disabled>تأكيد</button>
        </div>
      </section>`);

    const boxes = [...node.querySelectorAll('[data-otp] input')];
    const btn = node.querySelector('[data-verify]');
    const err = node.querySelector('[data-err]');
    const resend = node.querySelector('[data-resend]');
    node.querySelector('[data-back]').onclick = () => show(Screens.phone());

    const code = () => boxes.map((b) => b.value).join('');
    const sync = () => {
      boxes.forEach((b) => b.classList.toggle('filled', !!b.value));
      btn.disabled = code().length !== 4;
    };

    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        b.value = b.value.replace(/\D/g, '').slice(0, 1);
        err.classList.add('hidden');
        if (b.value && i < 3) boxes[i + 1].focus();
        sync();
        if (code().length === 4) btn.click();
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus();
      });
      b.addEventListener('paste', (e) => {
        const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
        if (!t) return;
        e.preventDefault();
        t.split('').forEach((c, j) => { if (boxes[j]) boxes[j].value = c; });
        sync();
        if (t.length === 4) btn.click();
      });
    });

    let left = resendAfterSec || 45;
    const tick = () => {
      if (left <= 0) { resend.disabled = false; resend.textContent = 'إعادة إرسال الرمز'; clearInterval(timer); return; }
      resend.textContent = `إعادة الإرسال بعد ${left} ثانية`;
      left -= 1;
    };
    const timer = setInterval(tick, 1000); tick();
    UI.onLeave(node, () => clearInterval(timer));

    resend.onclick = async () => {
      busy(resend, true);
      try {
        const res = await API.requestOtp(phone, via);
        toast('تم إرسال رمز جديد', 'success');
        left = res.resendAfterSec || 45; resend.disabled = true;
        if (res.devCode) toast('رمز التطوير: ' + res.devCode);
      } catch (e) { toast(e.message, 'error'); }
      finally { busy(resend, false); }
    };

    let verifying = false;
    btn.onclick = async () => {
      if (verifying || btn.disabled) return;
      verifying = true;
      busy(btn, true, 'جاري التحقق');
      try {
        const res = await API.verifyOtp(phone, code());
        clearInterval(timer);
        API.setToken(res.accessToken);
        App.setUser(res.user);
        if (!res.user.profileComplete && !App.skipProfileStep) show(Screens.completeProfile());
        else App.go('home');
      } catch (e) {
        err.textContent = e.message; err.classList.remove('hidden');
        boxes.forEach((b) => { b.value = ''; b.classList.remove('filled'); });
        boxes[0].focus(); sync();
      } finally { verifying = false; busy(btn, false); }
    };

    setTimeout(() => boxes[0].focus(), 220);
    return node;
  };

  /* --------------------------- استكمال الحساب --------------------------- */
  Screens.completeProfile = function completeProfileScreen() {
    const node = el(`
      <section class="screen screen--scroll">
        <div class="pad-x" style="padding-top:calc(var(--safe-t) + var(--s-8))">
          <h1 class="display">شو اسمك؟</h1>
          <p class="muted" style="font-size:17px;margin:var(--s-2) 0 var(--s-7)">حتى يعرفك الكابتن لما يوصل</p>

          <div class="avatar-edit" style="margin-bottom:var(--s-7)">
            <div class="avatar avatar--lg" data-avatar>${Icon('user', 38)}</div>
            <button class="avatar-edit__btn" data-pick aria-label="أضف صورة">${Icon('camera', 18)}</button>
            <input type="file" accept="image/*" class="hidden" data-file>
          </div>

          <label class="field">
            <span class="field__label">الاسم</span>
            <input class="input" data-name placeholder="مثال: أحمد الخالدي" maxlength="60" autocomplete="name">
          </label>
          <p class="field__error hidden" data-err></p>
        </div>
        <div class="spacer"></div>
        <div class="pad" style="padding-bottom:calc(var(--s-5) + var(--safe-b))">
          <button class="btn btn--primary" data-save disabled>يلا نبلّش</button>
        </div>
      </section>`);

    const name = node.querySelector('[data-name]');
    const btn = node.querySelector('[data-save]');
    const err = node.querySelector('[data-err]');
    const file = node.querySelector('[data-file]');
    const avatarBox = node.querySelector('[data-avatar]');

    name.addEventListener('input', () => { btn.disabled = name.value.trim().length < 2; err.classList.add('hidden'); });
    node.querySelector('[data-pick]').onclick = () => file.click();

    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        const dataUrl = await UI.resizeImage(f);
        avatarBox.innerHTML = `<img src="${dataUrl}" alt="">`;
        const res = await API.uploadPhoto(dataUrl);
        App.setUser(res.user);
        toast('تم حفظ الصورة', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };

    btn.onclick = async () => {
      busy(btn, true, 'جاري الحفظ');
      try {
        const res = await API.updateMe({ name: name.value.trim() });
        App.setUser(res.user);
        App.go('home');
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
      finally { busy(btn, false); }
    };

    setTimeout(() => name.focus(), 250);
    return node;
  };

  /* ------------------------------- الترحيب -------------------------------
     نفس تكوين شاشة البداية بالضبط + حقل الرقم. الضغط على الحقل يفتح شاشة إدخال الرقم. */
  Screens.welcome = function welcomeScreen() {
    const node = el(`
      <section class="screen screen--static stage">
        <div class="stage__castle"></div>
        <div class="stage__brand">
          <img class="stage__mark" src="/img/logo-mark.png" alt="" width="124" height="124">
          <img class="stage__word" src="/img/wordmark.png" alt="نشمي">
        </div>
        <button class="stage__field" data-start aria-label="أدخل رقم هاتفك">
          <span class="phone-field__flag">${JO_FLAG}</span>
          <span class="stage__chev">${Icon('forward', 14, 'style="transform:rotate(90deg)"')}</span>
          <span class="stage__cc">+962</span>
          <span class="stage__ph">7X XXX XXXX</span>
        </button>
      </section>`);
    node.querySelector('[data-start]').onclick = () => show(Screens.phone());
    return node;
  };
})();
