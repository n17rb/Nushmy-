/* أدوات واجهة مشتركة: عرض الشاشات، التنبيهات، النوافذ، المظهر. */
window.UI = (function () {
  const host = () => document.getElementById('screens');

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** عرض شاشة جديدة مكان الحالية */
  function show(node) {
    const h = host();
    const old = h.firstElementChild;
    if (old) old.remove();
    h.appendChild(node);
    node.scrollTop = 0;
    return node;
  }

  function toast(message, kind = '') {
    const box = document.getElementById('toasts');
    const t = el(`<div class="toast ${kind ? 'toast--' + kind : ''}">${esc(message)}</div>`);
    box.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0'; t.style.transform = 'translateY(-8px)';
      setTimeout(() => t.remove(), 260);
    }, 3200);
  }

  /** نافذة تأكيد — ترجع Promise<boolean> */
  function confirm({ title, body, confirmText = 'تأكيد', cancelText = 'تراجع', danger = false }) {
    return new Promise((resolve) => {
      const hostEl = document.getElementById('modal');
      const wrap = el(`
        <div class="modal-host">
          <div class="modal">
            <h2 class="h2" style="margin-bottom:var(--s-2)">${esc(title)}</h2>
            ${body ? `<p class="muted" style="margin:0 0 var(--s-5)">${esc(body)}</p>` : '<div style="height:var(--s-4)"></div>'}
            <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-yes>${esc(confirmText)}</button>
            <button class="btn btn--ghost" style="margin-top:var(--s-3)" data-no>${esc(cancelText)}</button>
          </div>
        </div>`);
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-yes]').onclick = () => done(true);
      wrap.querySelector('[data-no]').onclick = () => done(false);
      wrap.onclick = (e) => { if (e.target === wrap) done(false); };
      hostEl.appendChild(wrap);
    });
  }

  /** لوح خيارات */
  function sheet(html) {
    const hostEl = document.getElementById('modal');
    const wrap = el(`<div class="modal-host"><div class="modal">${html}</div></div>`);
    wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
    hostEl.appendChild(wrap);
    return { node: wrap, close: () => wrap.remove() };
  }

  /* -------------------- المظهر (فاتح / داكن / النظام) -------------------- */
  const THEME_KEY = 'nashmi.theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(pref) {
    const mode = pref === 'system' || !pref ? (media.matches ? 'dark' : 'light') : pref;
    document.documentElement.setAttribute('data-theme', mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0C0D10' : '#A60E35');
    document.documentElement.dataset.themePref = pref || 'system';
  }
  function setTheme(pref) {
    try { localStorage.setItem(THEME_KEY, pref); } catch {}
    applyTheme(pref);
  }
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
  }
  media.addEventListener('change', () => { if (getTheme() === 'system') applyTheme('system'); });

  /* -------------------- صيغ العرض -------------------- */
  const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  function dateText(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    const same = d.toDateString() === today.toDateString();
    const yest = new Date(today.getTime() - 86400000).toDateString() === d.toDateString();
    const time = d.toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
    if (same) return `اليوم ${time}`;
    if (yest) return `أمس ${time}`;
    return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} · ${time}`;
  }

  function initials(name) {
    if (!name) return '';
    const parts = String(name).trim().split(/\s+/);
    const first = parts[0][0] || '';
    // العربية لا تُختصر بحرفين — نكتفي بالحرف الأول
    if (/[\u0600-\u06FF]/.test(first)) return first;
    return first + (parts[1] ? parts[1][0] : '');
  }

  function avatar(user, cls = '') {
    if (user && user.photoUrl) return `<div class="avatar ${cls}"><img src="${esc(user.photoUrl)}" alt=""></div>`;
    const ini = initials(user && user.name);
    return `<div class="avatar ${cls}">${ini ? esc(ini) : Icon('user', 22)}</div>`;
  }

  /** تصغير الصورة في المتصفح قبل الرفع (لا نرفع ملفات ضخمة) */
  function resizeImage(file, max = 384) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('الملف ليس صورة صالحة'));
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          const c = document.createElement('canvas');
          c.width = c.height = Math.min(max, side);
          const ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, side, side, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.86));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spin" style="width:18px;height:18px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;display:inline-block;animation:sp .7s linear infinite"></span>${label ? ' ' + esc(label) : ''}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  const style = document.createElement('style');
  style.textContent = '@keyframes sp{to{transform:rotate(360deg)}}';
  document.head.appendChild(style);

  return { el, esc, show, toast, confirm, sheet, applyTheme, setTheme, getTheme, dateText, initials, avatar, resizeImage, busy };
})();
