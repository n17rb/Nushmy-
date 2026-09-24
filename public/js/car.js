/* ==========================================================
   CarArt — بطاقة السيارة الي بيشوفها الزبون
   ----------------------------------------------------------
   الصورة لازم تكون صورة السيارة الحقيقية، وكل السيارات بنفس الإطار (Style Bible):
     • اللوحة 1200×800 (3:2)، خلفية بيضاء
     • زاوية أمامية 3/4 ثابتة لكل السيارات، الكاميرا بارتفاع الكبوت، بدون ميلان
     • عرض السيارة 84% من اللوحة وبالنص، وأسفل العجلات عند 86% من الارتفاع
   الصورة بترفعها الإدارة مرة وحدة لكل فئة (سوناتا، كورولا…)، واللون بيبين كدائرة بالبطاقة.
   ما في صورة للفئة؟ بتطلع البطاقة بدون صورة — وبيوصل تنبيه للإدارة ترفعها.
   ========================================================== */
window.CarArt = (function () {
  const W = 1200, H = 800;          // إطار الـ Style Bible
  const GROUND = 0.86, WIDTH = 0.84;

  const ICON = '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16.5h16M6.5 16.5v2H4.5v-2M19.5 16.5v2h-2v-2"/><path d="M4 16.5l1.2-5a2.4 2.4 0 012.3-1.8h9a2.4 2.4 0 012.3 1.8l1.2 5"/><circle cx="7.6" cy="13.8" r=".9" fill="currentColor" stroke="none"/><circle cx="16.4" cy="13.8" r=".9" fill="currentColor" stroke="none"/></svg>';

  const placeholder = (text) => `<div class="car-art__empty">${ICON}${text ? `<span>${text}</span>` : ''}</div>`;

  /** الصورة ما زبطت تتحمّل ← منحط المكان الفاضي بدالها */
  function fail(img) {
    const box = img && img.parentNode;
    if (box) box.innerHTML = placeholder('');
  }

  /**
   * صورة السيارة داخل إطار ثابت.
   * @param {object} v vehicle من الخادم (imageUrl, label…)
   */
  function image(v, cls = '') {
    const url = v && v.imageUrl;
    if (!url) return `<div class="car-art ${cls}">${placeholder('')}</div>`;
    return `<div class="car-art ${cls}"><img src="${UI.esc(url)}" alt="${UI.esc((v && v.label) || 'سيارة')}" loading="lazy" onerror="CarArt.fail(this)"></div>`;
  }

  /** البطاقة الكاملة: صورة + الاسم + السنة واللون + المواصفات + اللوحة */
  function card(v) {
    if (!v) return '';
    const esc = UI.esc;
    const specs = [
      v.seats ? `${v.seats} مقاعد` : '',
      v.transmissionAr ? `ناقل ${v.transmissionAr}` : '',
      v.fuelAr || '',
    ].filter(Boolean);
    return `<div class="car-card">
      ${image(v)}
      <div class="car-card__name">${esc(v.label || [v.make, v.model].filter(Boolean).join(' '))}</div>
      <div class="car-card__meta"><span class="num">${esc(v.year || '')}</span>${v.year && v.color ? ' | ' : ''}${esc(v.color || '')}
        ${v.colorHex ? `<i class="car-card__dot" style="background:${esc(v.colorHex)}"></i>` : ''}</div>
      ${specs.length ? `<div class="car-card__specs">${specs.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
      ${v.plate ? `<div class="plate num">${esc(v.plate)}</div>` : ''}
    </div>`;
  }

  return { image, card, fail, placeholder, W, H, GROUND, WIDTH };
})();
