'use strict';
/**
 * أخطاء لها كود واضح ورسالة عربية مفهومة للمستخدم — لا "حدث خطأ ما" فقط.
 */
class AppError extends Error {
  constructor(code, messageAr, status = 400, details = null) {
    super(messageAr);
    this.code = code;
    this.messageAr = messageAr;
    this.status = status;
    this.details = details;
  }
}

const E = {
  VALIDATION_FAILED:      (m = 'البيانات المُدخلة غير صحيحة') => new AppError('VALIDATION_FAILED', m, 400),
  PHONE_INVALID:          () => new AppError('PHONE_INVALID', 'رقم الهاتف غير صحيح. أدخل رقم أردني يبدأ بـ 07', 400),
  OTP_RATE_LIMITED:       (s) => new AppError('OTP_RATE_LIMITED', `انتظر ${s} ثانية قبل طلب رمز جديد`, 429),
  OTP_TOO_MANY:           () => new AppError('OTP_TOO_MANY', 'طلبت رموزاً كثيرة. حاول بعد ساعة', 429),
  OTP_NOT_FOUND:          () => new AppError('OTP_NOT_FOUND', 'لا يوجد رمز فعّال لهذا الرقم. اطلب رمزاً جديداً', 400),
  OTP_EXPIRED:            () => new AppError('OTP_EXPIRED', 'انتهت صلاحية الرمز. اطلب رمزاً جديداً', 400),
  OTP_INVALID:            () => new AppError('OTP_INVALID', 'الرمز غير صحيح', 400),
  OTP_ATTEMPTS_EXCEEDED:  () => new AppError('OTP_ATTEMPTS_EXCEEDED', 'حاولت مرات كثيرة. اطلب رمزاً جديداً', 429),
  UNAUTHORIZED:           () => new AppError('UNAUTHORIZED', 'الجلسة منتهية. سجّل دخولك من جديد', 401),
  FORBIDDEN:              () => new AppError('FORBIDDEN', 'لا تملك صلاحية لهذا الإجراء', 403),
  ACCOUNT_SUSPENDED:      () => new AppError('ACCOUNT_SUSPENDED', 'الحساب موقوف. تواصل مع الدعم', 403),
  NOT_FOUND:              (m = 'العنصر غير موجود') => new AppError('NOT_FOUND', m, 404),
  TRIP_ACTIVE_EXISTS:     () => new AppError('TRIP_ACTIVE_EXISTS', 'لديك رحلة نشطة حالياً', 409),
  TRIP_INVALID_TRANSITION:() => new AppError('TRIP_INVALID_TRANSITION', 'لا يمكن تنفيذ هذا الإجراء على حالة الرحلة الحالية', 409),
  TRIP_ALREADY_ASSIGNED:  () => new AppError('TRIP_ALREADY_ASSIGNED', 'تم إسناد الرحلة لكابتن آخر', 409),
  NO_DRIVER_FOUND:        () => new AppError('NO_DRIVER_FOUND', 'لا يوجد كابتن متاح حالياً', 409),
  OUT_OF_SERVICE_AREA:    () => new AppError('OUT_OF_SERVICE_AREA', 'الموقع خارج منطقة الخدمة حالياً', 400),
  PRICING_NOT_CONFIGURED: () => new AppError('PRICING_NOT_CONFIGURED', 'التسعير غير مهيّأ. راجع لوحة الإدارة', 500),
  UPLOAD_TOO_LARGE:       () => new AppError('UPLOAD_TOO_LARGE', 'حجم الصورة كبير. الحد الأقصى 2 ميجابايت', 413),
  UPLOAD_INVALID_TYPE:    () => new AppError('UPLOAD_INVALID_TYPE', 'نوع الملف غير مدعوم. استخدم صورة JPG أو PNG', 400),
  RATE_LIMITED:           () => new AppError('RATE_LIMITED', 'طلبات كثيرة جداً. حاول بعد قليل', 429),
  CAPTAIN_NOT_REGISTERED: () => new AppError('CAPTAIN_NOT_REGISTERED', 'لم تسجّل ككابتن بعد', 403),
  CAPTAIN_NOT_APPROVED:   () => new AppError('CAPTAIN_NOT_APPROVED', 'حسابك قيد المراجعة. سنبلغك عند الموافقة', 403),
  CAPTAIN_ALREADY:        () => new AppError('CAPTAIN_ALREADY', 'أنت مسجّل ككابتن مسبقاً', 409),
  CAPTAIN_BUSY:           () => new AppError('CAPTAIN_BUSY', 'عندك رحلة نشطة حالياً', 409),
  WALLET_LOW:             (m) => new AppError('WALLET_LOW', m || 'رصيد محفظتك أقل من الحد المسموح. اشحن رصيدك لتستقبل رحلات', 403),
  OFFER_EXPIRED:          () => new AppError('OFFER_EXPIRED', 'انتهى وقت هذا الطلب', 409),
  LOCATION_REQUIRED:      () => new AppError('LOCATION_REQUIRED', 'موقعك غير معروف. فعّل الموقع وحاول مرة ثانية', 409),
  TOO_FAR_FROM_PICKUP:    (m) => new AppError('TOO_FAR_FROM_PICKUP', `أنت بعيد عن مكان الزبون (${m} م). اقترب أكثر ثم اضغط «وصلت»`, 409),
  NO_SHOW_TOO_EARLY:      (s) => new AppError('NO_SHOW_TOO_EARLY', `انتظر ${s} ثانية أخرى قبل تسجيل عدم حضور الزبون`, 409),
  INTERNAL:               () => new AppError('INTERNAL', 'خطأ غير متوقع في الخادم. تم تسجيله وسنراجعه', 500),
};

module.exports = { AppError, E };
