'use strict';
/**
 * أدوات إعداد واتساب (WhatsApp Cloud API) — تستخدمها صفحة «واتساب» بلوحة الإدارة.
 * - فحص كامل: رمز الوصول، الرقم، الاسم المعروض، مراجعة الحساب، القالب.
 * - إنشاء قالب المصادقة مباشرة عبر الـ API (بدل موقع Meta الي بيخبي سبب الرفض).
 * - إرسال رمز تجربة.
 * كل خطأ من Meta يرجع برسالته الأصلية + شرح عربي مفهوم.
 */
const config = require('../config');
const log = require('../lib/log');

const w = () => config.sms.whatsapp;

/** طلب لـ Graph API — ما بيرمي أخطاء، بيرجع { ok, status, data, error } */
async function graph(method, path, body) {
  const url = `https://graph.facebook.com/${w().apiVersion}/${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + w().token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && !data.error) return { ok: true, status: res.status, data };
    return { ok: false, status: res.status, error: describe(data.error || {}) };
  } catch (e) {
    return { ok: false, status: 0, error: { code: 'NETWORK', message: e.message, ar: 'تعذّر الاتصال بخوادم Meta. جرّب بعد شوي.' } };
  }
}

/** شرح عربي لأشهر أخطاء Meta */
function describe(err) {
  const code = Number(err.code), sub = Number(err.error_subcode);
  const meta = err.error_user_msg || (err.error_data && err.error_data.details) || err.message || '';
  let ar;
  if (code === 190) ar = 'رمز الوصول (WHATSAPP_TOKEN) غلط أو منتهي. اعمل رمز دائم من «مستخدمو النظام» وحطه بـ Render.';
  else if (code === 10 || code === 200 || code === 3) ar = 'رمز الوصول ما عنده صلاحية على هاد الحساب. تأكد إن مستخدم النظام معه حساب واتساب Nashmi (تحكم كامل)، وإن الرمز فيه صلاحيتي whatsapp_business_management و whatsapp_business_messaging.';
  else if (code === 100 && sub === 33) ar = 'المعرّف غلط أو الرمز ما بيشوفه. تأكد من WHATSAPP_PHONE_NUMBER_ID و WHATSAPP_WABA_ID بـ Render.';
  else if (code === 100 && (sub === 2388024 || /already exists/i.test(meta))) ar = 'القالب موجود أصلاً بنفس الاسم واللغة.';
  else if (code === 100 && sub === 2388023) ar = 'قالب بنفس الاسم انحذف قريباً. Meta بتمنع إعادة استخدام الاسم لفترة؛ غيّر WHATSAPP_TEMPLATE لاسم ثاني (مثلاً nashmi_code).';
  else if (code === 100) ar = 'Meta رفضت الطلب بسبب قيمة غير صحيحة. التفاصيل تحت.';
  else if (code === 368) ar = 'الحساب محظور مؤقتاً من Meta بسبب مخالفة سياسات. راجع «جودة الحساب» بـ WhatsApp Manager.';
  else if (code === 131031) ar = 'حساب واتساب مقفل من Meta. لازم تراجع دعم Meta.';
  else if (code === 133010) ar = 'الرقم مش مسجّل على الـ Cloud API. سجّله من developers.facebook.com ← الخطوة 2.';
  else if (code === 131030) ar = 'الرقم المستقبل مش ضمن القائمة المسموحة (هاد بيصير بس مع الرقم التجريبي من Meta).';
  else if (code === 132001) ar = 'القالب مش موجود أو لسا مش معتمد بهاي اللغة.';
  else if (code === 131047 || code === 131026) ar = 'ما قدرنا نوصل لهاد الرقم على واتساب (يمكن ما عليه واتساب).';
  else if (code === 4 || code === 80007 || code === 130429) ar = 'طلبات كثيرة. استنى دقائق وجرّب.';
  else ar = 'Meta رفضت الطلب. التفاصيل تحت.';
  return { code: code || null, subcode: sub || null, message: meta, ar, trace: err.fbtrace_id || null };
}

const NAME_STATUS = {
  APPROVED: ['ok', 'مقبول'], AVAILABLE_WITHOUT_REVIEW: ['ok', 'متاح'], PENDING_REVIEW: ['warn', 'قيد المراجعة'],
  DECLINED: ['bad', 'مرفوض'], EXPIRED: ['bad', 'منتهي'], NONE: ['warn', 'غير محدد'],
};
const REVIEW_STATUS = { APPROVED: ['ok', 'مقبول'], PENDING: ['warn', 'قيد المراجعة'], REJECTED: ['bad', 'مرفوض'] };
const TPL_STATUS = {
  APPROVED: ['ok', 'نشط'], PENDING: ['warn', 'قيد المراجعة'], REJECTED: ['bad', 'مرفوض'],
  PAUSED: ['warn', 'موقوف مؤقتاً'], DISABLED: ['bad', 'معطّل'], IN_APPEAL: ['warn', 'قيد الاستئناف'],
};

/** فحص كامل — بيرجع قائمة خطوات، كل وحدة: ok / warn / bad / todo مع شرح */
async function status() {
  const cfg = w();
  const steps = [];
  const add = (key, state, title, detail, extra = {}) => steps.push({ key, state, title, detail, ...extra });

  const missing = [
    !cfg.token && 'WHATSAPP_TOKEN',
    !cfg.phoneNumberId && 'WHATSAPP_PHONE_NUMBER_ID',
    !cfg.wabaId && 'WHATSAPP_WABA_ID',
  ].filter(Boolean);
  add('config', missing.length ? 'bad' : 'ok', 'إعدادات Render',
    missing.length ? `ناقص: ${missing.join('، ')}` : 'رمز الوصول ومعرّف الرقم ومعرّف الحساب موجودين');
  if (missing.length) return { steps, ready: false, provider: config.sms.provider, template: cfg.template, lang: cfg.lang };

  // الرقم (وبنفس الوقت بنفحص إنه رمز الوصول شغال)
  const ph = await graph('GET', `${cfg.phoneNumberId}?fields=display_phone_number,verified_name,name_status,code_verification_status,quality_rating,platform_type,status`);
  if (!ph.ok) {
    add('token', 'bad', 'رمز الوصول', ph.error.ar, { error: ph.error });
    return { steps, ready: false, provider: config.sms.provider, template: cfg.template, lang: cfg.lang };
  }
  add('token', 'ok', 'رمز الوصول', 'صالح وبيوصل للرقم');
  const p = ph.data;
  const registered = p.platform_type === 'CLOUD_API';
  add('number', registered ? 'ok' : 'bad', 'تسجيل الرقم',
    registered ? `${p.display_phone_number} مسجّل على الـ Cloud API${p.status ? ` (${p.status})` : ''}`
      : `${p.display_phone_number || ''} مش مسجّل. روح على developers.facebook.com ← الخطوة 2 ← «تسجيل» وحط PIN من 6 أرقام إنجليزي.`,
    { phone: p.display_phone_number, quality: p.quality_rating });
  const ns = NAME_STATUS[p.name_status] || ['warn', p.name_status || 'غير معروف'];
  add('name', ns[0], 'الاسم المعروض', `${p.verified_name || '—'}: ${ns[1]}${ns[0] === 'warn' ? ' — استنى موافقة Meta (عادةً ساعات لـ يومين)' : ''}`);

  // الحساب
  const wa = await graph('GET', `${cfg.wabaId}?fields=name,account_review_status,currency`);
  if (!wa.ok) {
    add('account', 'bad', 'حساب واتساب (WABA)', wa.error.ar, { error: wa.error });
  } else {
    const rs = REVIEW_STATUS[wa.data.account_review_status] || ['warn', wa.data.account_review_status || 'غير معروف'];
    add('account', rs[0], 'مراجعة الحساب من Meta',
      `${wa.data.name || ''}: ${rs[1]}${rs[0] === 'warn' ? ' — القوالب ممكن تضل مقفلة لحد ما تخلص المراجعة' : ''}${rs[0] === 'bad' ? ' — لازم تقدّم طلب مراجعة من WhatsApp Manager' : ''}`);
  }

  // القالب
  let tpl = null;
  const tl = await graph('GET', `${cfg.wabaId}/message_templates?fields=name,status,language,category,rejected_reason&limit=100`);
  if (!tl.ok) {
    add('template', 'bad', `القالب ${cfg.template}`, tl.error.ar, { error: tl.error });
  } else {
    const list = (tl.data.data || []).filter((t) => t.name === cfg.template);
    tpl = list.find((t) => t.language === cfg.lang) || list[0] || null;
    if (!tpl) {
      add('template', 'todo', `القالب ${cfg.template}`, 'مش موجود لسا — اكبس «إنشاء القالب» تحت.', { canCreate: true });
    } else {
      const ts = TPL_STATUS[tpl.status] || ['warn', tpl.status];
      const langNote = tpl.language !== cfg.lang ? ` — لغته ${tpl.language} بس الإعداد ${cfg.lang}، حط WHATSAPP_TEMPLATE_LANG=${tpl.language} بـ Render` : '';
      add('template', langNote ? 'warn' : ts[0], `القالب ${cfg.template}`,
        `${ts[1]}${tpl.rejected_reason && tpl.rejected_reason !== 'NONE' ? ` (السبب: ${tpl.rejected_reason})` : ''}${langNote}`,
        { canCreate: tpl.status === 'REJECTED' });
    }
  }

  const blocking = steps.some((s) => s.state === 'bad' || s.state === 'todo');
  const ready = !blocking && tpl && tpl.status === 'APPROVED';
  add('provider', config.sms.provider === 'whatsapp' ? 'ok' : (ready ? 'todo' : 'warn'), 'تشغيل الإرسال على واتساب',
    config.sms.provider === 'whatsapp'
      ? 'SMS_PROVIDER = whatsapp — الرموز بتنبعت على واتساب'
      : ready ? 'كل إشي جاهز ✓ — جرّب «إرسال رمز تجربة»، وإذا وصلك غيّر SMS_PROVIDER لـ whatsapp بـ Render'
        : `SMS_PROVIDER = ${config.sms.provider} — خليه هيك لحد ما تصير كل الخطوات فوق ✓`);

  return { steps, ready: Boolean(ready), provider: config.sms.provider, template: cfg.template, lang: cfg.lang };
}

/** إنشاء قالب المصادقة (نص Meta الجاهز + زر نسخ الرمز + مدة الصلاحية) */
async function createTemplate() {
  const cfg = w();
  const minutes = Math.max(1, Math.min(90, Math.round(config.otp.ttlSec / 60)));
  const body = {
    name: cfg.template,
    language: cfg.lang,
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: minutes },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'نسخ الرمز' }] },
    ],
  };
  const r = await graph('POST', `${cfg.wabaId}/message_templates`, body);
  if (r.ok) {
    log.info('قالب واتساب انعمل', { id: r.data.id, status: r.data.status });
    return { ok: true, id: r.data.id, status: r.data.status };
  }
  if (r.error && /موجود أصلاً/.test(r.error.ar)) return { ok: true, exists: true };
  return { ok: false, error: r.error };
}

/** إرسال رمز تجربة لرقم (نفس شكل رسالة الدخول بالضبط) */
async function sendTest(phoneE164, code) {
  const cfg = w();
  const components = [{ type: 'body', parameters: [{ type: 'text', text: code }] }];
  if (cfg.copyButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
  const r = await graph('POST', `${cfg.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: phoneE164.replace(/^\+/, ''), type: 'template',
    template: { name: cfg.template, language: { code: cfg.lang }, components },
  });
  return r.ok ? { ok: true, messageId: r.data.messages && r.data.messages[0] && r.data.messages[0].id } : { ok: false, error: r.error };
}

module.exports = { graph, describe, status, createTemplate, sendTest };
