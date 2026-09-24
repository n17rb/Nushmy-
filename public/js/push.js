/* ==========================================================
   PushKit — تفعيل الإشعارات الفورية على التلفون (متل إنستقرام)
   • أندرويد / كمبيوتر: من المتصفح مباشرة
   • آيفون: لازم «إضافة للشاشة الرئيسية» أول (iOS 16.4+) وبعدين تفعيل
   • تطبيق المتجر (Capacitor): إذا في window.NashmiNative.pushToken بنسجّل رمز Firebase
   ========================================================== */
window.PushKit = (function () {
  const app = () => (location.pathname.startsWith('/captain') ? 'captain' : location.pathname.startsWith('/admin') ? 'admin' : 'customer');
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function keyBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  /** الحالة: 'on' | 'off' | 'denied' | 'unsupported' | 'ios-install' */
  async function state() {
    if (window.NashmiNative && window.NashmiNative.pushToken) return 'on';
    if (!supported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return sub && Notification.permission === 'granted' ? 'on' : 'off';
    } catch { return 'off'; }
  }

  /** طلب الإذن والاشتراك — لازم ينادى من ضغطة زر */
  async function enable() {
    if (window.NashmiNative && window.NashmiNative.pushToken) {
      await API.post('/api/push/register', { token: window.NashmiNative.pushToken, app: app() });
      return 'on';
    }
    if (!supported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await API.get('/api/push/key', { auth: false });
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    await API.post('/api/push/subscribe', { subscription: sub.toJSON(), app: app() });
    return 'on';
  }

  /** بعد تسجيل الدخول: لو الإذن معطى من قبل، منجدد الاشتراك بصمت (بدون ما نسأل) */
  async function refresh() {
    try {
      if (window.NashmiNative && window.NashmiNative.pushToken) return enable();
      if (supported() && Notification.permission === 'granted') await enable();
    } catch {}
  }

  const TEXT = {
    on: 'الإشعارات شغالة على هاد الجهاز ✓',
    off: 'فعّل الإشعارات عشان توصلك العروض ورسائل الكابتن والدعم حتى لو التطبيق مسكّر',
    denied: 'الإشعارات مسكّرة من إعدادات المتصفح. افتح إعدادات الموقع واسمح بالإشعارات',
    unsupported: 'هاد المتصفح ما بيدعم الإشعارات. جرّب Chrome',
    'ios-install': 'على الآيفون: اضغط زر المشاركة ⎋ ثم «إضافة إلى الشاشة الرئيسية»، وافتح نشمي من الأيقونة وفعّل الإشعارات',
  };

  return { state, enable, refresh, TEXT, app };
})();
