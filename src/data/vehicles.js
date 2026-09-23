'use strict';
/**
 * كتالوج السيارات — الشركة ← الفئة (مش «موديل»، لأن الناس بتفهم الموديل = السنة).
 * كل فئة: [المعرّف، الاسم الإنجليزي، الاسم العربي، الشكل، المقاعد، الوقود]
 *   الشكل: sedan صالون · hatch هاتشباك · suv جيب/كروس أوفر · van فان/عائلية · pickup بكب
 *   الوقود: petrol بنزين · hybrid هايبرد · electric كهرباء · diesel ديزل
 * بتقدر تضيف أي شركة أو فئة هون، والتطبيق بياخذها لحاله.
 */
const S = 'sedan', H = 'hatch', U = 'suv', V = 'van', P = 'pickup';
const p = 'petrol', h = 'hybrid', e = 'electric', d = 'diesel';

const MAKES = [
  ['hyundai', 'Hyundai', 'هيونداي', [
    ['accent', 'Accent', 'أكسنت', S, 5, p], ['elantra', 'Elantra', 'إلنترا', S, 5, p], ['avante', 'Avante', 'أفانتي', S, 5, p],
    ['elantra-hybrid', 'Elantra Hybrid', 'إلنترا هايبرد', S, 5, h], ['sonata', 'Sonata', 'سوناتا', S, 5, p],
    ['sonata-hybrid', 'Sonata Hybrid', 'سوناتا هايبرد', S, 5, h], ['azera', 'Azera / Grandeur', 'أزيرا / جراندير', S, 5, p],
    ['i10', 'i10', 'i10', H, 4, p], ['i20', 'i20', 'i20', H, 5, p], ['i30', 'i30', 'i30', H, 5, p],
    ['ioniq', 'Ioniq', 'أيونك', H, 5, h], ['ioniq-ev', 'Ioniq Electric', 'أيونك كهرباء', H, 5, e],
    ['ioniq5', 'Ioniq 5', 'أيونك 5', U, 5, e], ['ioniq6', 'Ioniq 6', 'أيونك 6', S, 5, e],
    ['venue', 'Venue', 'فينيو', U, 5, p], ['creta', 'Creta', 'كريتا', U, 5, p], ['kona', 'Kona', 'كونا', U, 5, p],
    ['kona-ev', 'Kona Electric', 'كونا كهرباء', U, 5, e], ['tucson', 'Tucson', 'توسان', U, 5, p],
    ['santafe', 'Santa Fe', 'سانتافي', U, 7, p], ['palisade', 'Palisade', 'باليسيد', U, 8, p],
    ['staria', 'Staria', 'ستاريا', V, 9, d], ['h1', 'H-1', 'H-1', V, 9, d],
  ]],
  ['kia', 'Kia', 'كيا', [
    ['picanto', 'Picanto', 'بيكانتو', H, 4, p], ['rio', 'Rio', 'ريو', S, 5, p], ['pegas', 'Pegas', 'بيجاس', S, 5, p],
    ['cerato', 'Cerato / K3', 'سيراتو / K3', S, 5, p], ['forte', 'Forte', 'فورتي', S, 5, p],
    ['optima', 'Optima', 'أوبتيما', S, 5, p], ['optima-hybrid', 'Optima Hybrid', 'أوبتيما هايبرد', S, 5, h],
    ['k5', 'K5', 'K5', S, 5, p], ['k5-hybrid', 'K5 Hybrid', 'K5 هايبرد', S, 5, h], ['cadenza', 'Cadenza / K7', 'كادينزا / K7', S, 5, p],
    ['k8', 'K8', 'K8', S, 5, p], ['soul', 'Soul', 'سول', H, 5, p], ['soul-ev', 'Soul EV', 'سول كهرباء', H, 5, e],
    ['niro', 'Niro', 'نيرو', U, 5, h], ['niro-ev', 'Niro EV', 'نيرو كهرباء', U, 5, e], ['seltos', 'Seltos', 'سيلتوس', U, 5, p],
    ['sportage', 'Sportage', 'سبورتاج', U, 5, p], ['sorento', 'Sorento', 'سورينتو', U, 7, p],
    ['carens', 'Carens', 'كارينز', V, 7, p], ['carnival', 'Carnival', 'كرنفال', V, 8, p],
    ['ev5', 'EV5', 'EV5', U, 5, e], ['ev6', 'EV6', 'EV6', U, 5, e], ['ev9', 'EV9', 'EV9', U, 7, e],
  ]],
  ['toyota', 'Toyota', 'تويوتا', [
    ['yaris', 'Yaris', 'يارس', S, 5, p], ['corolla', 'Corolla', 'كورولا', S, 5, p], ['corolla-hybrid', 'Corolla Hybrid', 'كورولا هايبرد', S, 5, h],
    ['camry', 'Camry', 'كامري', S, 5, p], ['camry-hybrid', 'Camry Hybrid', 'كامري هايبرد', S, 5, h], ['avalon', 'Avalon', 'أفالون', S, 5, p],
    ['prius', 'Prius', 'بريوس', H, 5, h], ['crown', 'Crown', 'كراون', S, 5, h], ['raize', 'Raize', 'رايز', U, 5, p],
    ['chr', 'C-HR', 'C-HR', U, 5, h], ['corolla-cross', 'Corolla Cross', 'كورولا كروس', U, 5, h], ['rav4', 'RAV4', 'راف فور', U, 5, p],
    ['rush', 'Rush', 'راش', U, 7, p], ['veloz', 'Veloz', 'فيلوز', V, 7, p], ['innova', 'Innova', 'إنوفا', V, 7, p],
    ['fortuner', 'Fortuner', 'فورتشنر', U, 7, p], ['prado', 'Land Cruiser Prado', 'برادو', U, 7, p],
    ['landcruiser', 'Land Cruiser', 'لاندكروزر', U, 8, p], ['bz4x', 'bZ4X', 'bZ4X', U, 5, e],
    ['hiace', 'Hiace', 'هايس', V, 12, d], ['hilux', 'Hilux', 'هايلكس', P, 5, d],
  ]],
  ['nissan', 'Nissan', 'نيسان', [
    ['micra', 'Micra', 'ميكرا', H, 5, p], ['sunny', 'Sunny', 'صني', S, 5, p], ['tiida', 'Tiida', 'تيدا', H, 5, p],
    ['sentra', 'Sentra', 'سنترا', S, 5, p], ['altima', 'Altima', 'ألتيما', S, 5, p], ['maxima', 'Maxima', 'ماكسيما', S, 5, p],
    ['leaf', 'Leaf', 'ليف', H, 5, e], ['kicks', 'Kicks', 'كيكس', U, 5, p], ['qashqai', 'Qashqai', 'قشقاي', U, 5, p],
    ['xtrail', 'X-Trail', 'إكس تريل', U, 7, p], ['pathfinder', 'Pathfinder', 'باثفايندر', U, 7, p],
    ['patrol', 'Patrol', 'باترول', U, 8, p], ['urvan', 'Urvan', 'أورفان', V, 12, d], ['navara', 'Navara', 'نافارا', P, 5, d],
  ]],
  ['honda', 'Honda', 'هوندا', [
    ['city', 'City', 'سيتي', S, 5, p], ['jazz', 'Jazz / Fit', 'جاز', H, 5, p], ['civic', 'Civic', 'سيفيك', S, 5, p],
    ['accord', 'Accord', 'أكورد', S, 5, p], ['accord-hybrid', 'Accord Hybrid', 'أكورد هايبرد', S, 5, h],
    ['hrv', 'HR-V', 'HR-V', U, 5, p], ['crv', 'CR-V', 'CR-V', U, 5, p], ['ens1', 'e:NS1', 'e:NS1', U, 5, e],
    ['pilot', 'Pilot', 'بايلوت', U, 8, p], ['odyssey', 'Odyssey', 'أوديسي', V, 8, p],
  ]],
  ['mitsubishi', 'Mitsubishi', 'ميتسوبيشي', [
    ['attrage', 'Attrage', 'أتراج', S, 5, p], ['mirage', 'Mirage', 'ميراج', H, 5, p], ['lancer', 'Lancer', 'لانسر', S, 5, p],
    ['asx', 'ASX', 'ASX', U, 5, p], ['eclipse-cross', 'Eclipse Cross', 'إكلبس كروس', U, 5, p],
    ['xpander', 'Xpander', 'إكسباندر', V, 7, p], ['outlander', 'Outlander', 'أوتلاندر', U, 7, p],
    ['pajero', 'Pajero', 'باجيرو', U, 7, p], ['l200', 'L200', 'L200', P, 5, d],
  ]],
  ['mazda', 'Mazda', 'مازدا', [
    ['mazda2', 'Mazda 2', 'مازدا 2', H, 5, p], ['mazda3', 'Mazda 3', 'مازدا 3', S, 5, p], ['mazda6', 'Mazda 6', 'مازدا 6', S, 5, p],
    ['cx3', 'CX-3', 'CX-3', U, 5, p], ['cx30', 'CX-30', 'CX-30', U, 5, p], ['cx5', 'CX-5', 'CX-5', U, 5, p], ['cx9', 'CX-9', 'CX-9', U, 7, p],
  ]],
  ['chevrolet', 'Chevrolet', 'شفروليه', [
    ['spark', 'Spark', 'سبارك', H, 4, p], ['aveo', 'Aveo', 'أفيو', S, 5, p], ['optra', 'Optra', 'أوبترا', S, 5, p],
    ['cruze', 'Cruze', 'كروز', S, 5, p], ['malibu', 'Malibu', 'ماليبو', S, 5, p], ['impala', 'Impala', 'إمبالا', S, 5, p],
    ['volt', 'Volt', 'فولت', H, 4, h], ['bolt', 'Bolt EV', 'بولت', H, 5, e], ['captiva', 'Captiva', 'كابتيفا', U, 7, p],
    ['equinox', 'Equinox', 'إكوينوكس', U, 5, p], ['tahoe', 'Tahoe', 'تاهو', U, 8, p],
  ]],
  ['ford', 'Ford', 'فورد', [
    ['fiesta', 'Fiesta', 'فييستا', H, 5, p], ['focus', 'Focus', 'فوكس', S, 5, p], ['fusion', 'Fusion', 'فيوجن', S, 5, p],
    ['fusion-hybrid', 'Fusion Hybrid', 'فيوجن هايبرد', S, 5, h], ['taurus', 'Taurus', 'توروس', S, 5, p],
    ['escape', 'Escape', 'إسكيب', U, 5, p], ['edge', 'Edge', 'إيدج', U, 5, p], ['explorer', 'Explorer', 'إكسبلورر', U, 7, p],
    ['expedition', 'Expedition', 'إكسبديشن', U, 8, p], ['ranger', 'Ranger', 'رينجر', P, 5, d],
  ]],
  ['volkswagen', 'Volkswagen', 'فولكس فاجن', [
    ['polo', 'Polo', 'بولو', H, 5, p], ['golf', 'Golf', 'جولف', H, 5, p], ['egolf', 'e-Golf', 'إي-جولف', H, 5, e],
    ['jetta', 'Jetta', 'جيتا', S, 5, p], ['lavida', 'Lavida', 'لافيدا', S, 5, p], ['ebora', 'e-Bora', 'إي-بورا', S, 5, e],
    ['passat', 'Passat', 'باسات', S, 5, p], ['tiguan', 'Tiguan', 'تيغوان', U, 5, p],
    ['id3', 'ID.3', 'ID.3', H, 5, e], ['id4', 'ID.4', 'ID.4', U, 5, e], ['id6', 'ID.6', 'ID.6', U, 7, e],
  ]],
  ['byd', 'BYD', 'بي واي دي', [
    ['seagull', 'Seagull', 'سيغل', H, 4, e], ['dolphin', 'Dolphin', 'دولفين', H, 5, e], ['qin-plus', 'Qin Plus', 'تشين بلس', S, 5, e],
    ['destroyer05', 'Destroyer 05', 'ديسترويَر 05', S, 5, h], ['seal', 'Seal', 'سيل', S, 5, e], ['han', 'Han', 'هان', S, 5, e],
    ['atto3', 'Atto 3 / Yuan Plus', 'أتو 3 / يوان بلس', U, 5, e], ['song-plus', 'Song Plus', 'سونغ بلس', U, 5, e],
    ['seal-u', 'Seal U', 'سيل U', U, 5, e], ['tang', 'Tang', 'تانغ', U, 7, e],
  ]],
  ['geely', 'Geely', 'جيلي', [
    ['emgrand', 'Emgrand', 'إمجراند', S, 5, p], ['geometry-c', 'Geometry C', 'جيومتري C', H, 5, e],
    ['coolray', 'Coolray', 'كولراي', U, 5, p], ['galaxy-e5', 'Galaxy E5', 'جالاكسي E5', U, 5, e],
    ['tugella', 'Tugella', 'توجيلا', U, 5, p], ['monjaro', 'Monjaro', 'مونجارو', U, 5, p], ['okavango', 'Okavango', 'أوكافانغو', U, 7, p],
  ]],
  ['chery', 'Chery', 'شيري', [
    ['arrizo5', 'Arrizo 5', 'أريزو 5', S, 5, p], ['arrizo6', 'Arrizo 6', 'أريزو 6', S, 5, p], ['arrizo8', 'Arrizo 8', 'أريزو 8', S, 5, p],
    ['tiggo2', 'Tiggo 2', 'تيجو 2', U, 5, p], ['tiggo4', 'Tiggo 4', 'تيجو 4', U, 5, p],
    ['tiggo7', 'Tiggo 7', 'تيجو 7', U, 5, p], ['tiggo8', 'Tiggo 8', 'تيجو 8', U, 7, p],
  ]],
  ['mg', 'MG', 'إم جي', [
    ['mg3', 'MG3', 'MG3', H, 5, p], ['mg5', 'MG5', 'MG5', S, 5, p], ['mg6', 'MG6', 'MG6', S, 5, p], ['mggt', 'MG GT', 'MG GT', S, 5, p],
    ['mg4', 'MG4 EV', 'MG4 كهرباء', H, 5, e], ['zs', 'ZS', 'ZS', U, 5, p], ['zs-ev', 'ZS EV', 'ZS كهرباء', U, 5, e],
    ['hs', 'HS', 'HS', U, 5, p], ['rx5', 'RX5', 'RX5', U, 5, p], ['rx8', 'RX8', 'RX8', U, 7, p],
  ]],
  ['changan', 'Changan', 'شانجان', [
    ['alsvin', 'Alsvin', 'ألسفين', S, 5, p], ['eado', 'Eado', 'إيدو', S, 5, p], ['cs35', 'CS35 Plus', 'CS35 بلس', U, 5, p],
    ['cs55', 'CS55 Plus', 'CS55 بلس', U, 5, p], ['cs75', 'CS75 Plus', 'CS75 بلس', U, 5, p], ['cs85', 'CS85', 'CS85', U, 5, p],
    ['unik', 'UNI-K', 'يوني K', U, 5, p], ['unit', 'UNI-T', 'يوني T', U, 5, p],
  ]],
  ['haval', 'Haval', 'هافال', [['jolion', 'Jolion', 'جوليون', U, 5, p], ['h6', 'H6', 'H6', U, 5, p], ['dargo', 'Dargo', 'دارجو', U, 5, p]]],
  ['jetour', 'Jetour', 'جيتور', [['dashing', 'Dashing', 'داشينغ', U, 5, p], ['x70', 'X70', 'X70', U, 7, p], ['x90', 'X90', 'X90', U, 7, p]]],
  ['gac', 'GAC', 'جي إيه سي', [
    ['ga4', 'GA4', 'GA4', S, 5, p], ['empow', 'Empow', 'إمباو', S, 5, p], ['gs3', 'GS3', 'GS3', U, 5, p], ['gs4', 'GS4', 'GS4', U, 5, p],
    ['aion-s', 'Aion S', 'أيون S', S, 5, e], ['aion-y', 'Aion Y', 'أيون Y', U, 5, e], ['gs8', 'GS8', 'GS8', U, 7, p],
  ]],
  ['tesla', 'Tesla', 'تسلا', [['model3', 'Model 3', 'موديل 3', S, 5, e], ['modely', 'Model Y', 'موديل Y', U, 5, e], ['models', 'Model S', 'موديل S', S, 5, e], ['modelx', 'Model X', 'موديل X', U, 7, e]]],
  ['zeekr', 'Zeekr', 'زيكر', [['z001', '001', '001', S, 5, e], ['z007', '007', '007', S, 5, e], ['zx', 'X', 'X', U, 5, e]]],
  ['leapmotor', 'Leapmotor', 'ليب موتور', [['t03', 'T03', 'T03', H, 4, e], ['c01', 'C01', 'C01', S, 5, e], ['c10', 'C10', 'C10', U, 5, e], ['c11', 'C11', 'C11', U, 5, e]]],
  ['neta', 'Neta', 'نيتا', [['neta-v', 'V', 'V', U, 5, e], ['neta-u', 'U', 'U', U, 5, e], ['neta-s', 'S', 'S', S, 5, e], ['aya', 'Aya', 'آيا', H, 5, e]]],
  ['mercedes', 'Mercedes-Benz', 'مرسيدس', [
    ['a-class', 'A-Class', 'A-Class', H, 5, p], ['c-class', 'C-Class', 'C-Class', S, 5, p], ['e-class', 'E-Class', 'E-Class', S, 5, p],
    ['s-class', 'S-Class', 'S-Class', S, 5, p], ['glc', 'GLC', 'GLC', U, 5, p], ['gle', 'GLE', 'GLE', U, 7, p],
    ['v-class', 'V-Class', 'V-Class', V, 8, d], ['vito', 'Vito', 'فيتو', V, 9, d],
  ]],
  ['bmw', 'BMW', 'بي إم دبليو', [
    ['s3', '3 Series', 'الفئة الثالثة', S, 5, p], ['s5', '5 Series', 'الفئة الخامسة', S, 5, p], ['s7', '7 Series', 'الفئة السابعة', S, 5, p],
    ['x3', 'X3', 'X3', U, 5, p], ['x5', 'X5', 'X5', U, 5, p], ['i3', 'i3', 'i3', H, 4, e], ['ix3', 'iX3', 'iX3', U, 5, e],
  ]],
  ['lexus', 'Lexus', 'لكزس', [['is', 'IS', 'IS', S, 5, p], ['es', 'ES', 'ES', S, 5, h], ['ls', 'LS', 'LS', S, 5, p], ['nx', 'NX', 'NX', U, 5, h], ['rx', 'RX', 'RX', U, 5, h], ['lx', 'LX', 'LX', U, 8, p]]],
  ['audi', 'Audi', 'أودي', [['a3', 'A3', 'A3', S, 5, p], ['a4', 'A4', 'A4', S, 5, p], ['a6', 'A6', 'A6', S, 5, p], ['q5', 'Q5', 'Q5', U, 5, p], ['q7', 'Q7', 'Q7', U, 7, p], ['etron', 'e-tron', 'e-tron', U, 5, e]]],
  ['peugeot', 'Peugeot', 'بيجو', [
    ['p206', '206', '206', H, 5, p], ['p301', '301', '301', S, 5, p], ['p308', '308', '308', H, 5, p], ['p508', '508', '508', S, 5, p],
    ['p2008', '2008', '2008', U, 5, p], ['p3008', '3008', '3008', U, 5, p], ['p5008', '5008', '5008', U, 7, p],
  ]],
  ['renault', 'Renault', 'رينو', [
    ['symbol', 'Symbol', 'سيمبول', S, 5, p], ['clio', 'Clio', 'كليو', H, 5, p], ['megane', 'Megane', 'ميجان', S, 5, p],
    ['fluence', 'Fluence', 'فلوانس', S, 5, p], ['zoe', 'Zoe', 'زوي', H, 5, e], ['duster', 'Duster', 'داستر', U, 5, p], ['koleos', 'Koleos', 'كوليوس', U, 5, p],
  ]],
  ['skoda', 'Skoda', 'سكودا', [['fabia', 'Fabia', 'فابيا', H, 5, p], ['rapid', 'Rapid', 'رابيد', S, 5, p], ['octavia', 'Octavia', 'أوكتافيا', S, 5, p], ['superb', 'Superb', 'سوبيرب', S, 5, p], ['kodiaq', 'Kodiaq', 'كودياك', U, 7, p]]],
  ['suzuki', 'Suzuki', 'سوزوكي', [
    ['swift', 'Swift', 'سويفت', H, 5, p], ['dzire', 'Dzire', 'ديزاير', S, 5, p], ['ciaz', 'Ciaz', 'سياز', S, 5, p], ['baleno', 'Baleno', 'بالينو', H, 5, p],
    ['ertiga', 'Ertiga', 'إرتيغا', V, 7, p], ['vitara', 'Vitara', 'فيتارا', U, 5, p], ['jimny', 'Jimny', 'جيمني', U, 4, p],
  ]],
  ['jeep', 'Jeep', 'جيب', [['compass', 'Compass', 'كومباس', U, 5, p], ['cherokee', 'Cherokee', 'شيروكي', U, 5, p], ['grand-cherokee', 'Grand Cherokee', 'جراند شيروكي', U, 5, p], ['wrangler', 'Wrangler', 'رانجلر', U, 5, p]]],
  ['dodge', 'Dodge', 'دودج', [['charger', 'Charger', 'تشارجر', S, 5, p], ['durango', 'Durango', 'دورانجو', U, 7, p]]],
  ['gmc', 'GMC', 'جي إم سي', [['acadia', 'Acadia', 'أكاديا', U, 7, p], ['yukon', 'Yukon', 'يوكن', U, 8, p], ['sierra', 'Sierra', 'سييرا', P, 5, p]]],
  ['isuzu', 'Isuzu', 'إيسوزو', [['dmax', 'D-Max', 'دي ماكس', P, 5, d]]],
];

const BODY_AR = { sedan: 'صالون', hatch: 'هاتشباك', suv: 'جيب', van: 'عائلية', pickup: 'بكب' };
const FUEL_AR = { petrol: 'بنزين', hybrid: 'هايبرد', electric: 'كهرباء', diesel: 'ديزل' };
const TRANSMISSION_AR = { automatic: 'أوتوماتيك', manual: 'عادي (جير)' };

/** ألوان السيارات — مع لون العرض للرسمة */
const COLORS = [
  ['white', 'أبيض', '#F4F5F7'], ['pearl', 'لؤلؤي', '#ECE9E1'], ['silver', 'فضي', '#C3C7CC'], ['gray', 'رمادي', '#7D838B'],
  ['black', 'أسود', '#1E2126'], ['red', 'أحمر', '#B3202A'], ['maroon', 'خمري', '#6E1A2A'], ['blue', 'أزرق', '#2458A6'],
  ['navy', 'كحلي', '#1D2B4A'], ['beige', 'بيج', '#CDBB9C'], ['gold', 'ذهبي', '#B89B5E'], ['brown', 'بني', '#5C4331'],
  ['green', 'أخضر', '#2F5D46'], ['orange', 'برتقالي', '#D66A1F'], ['yellow', 'أصفر', '#E2B72A'],
];

const catalog = {
  makes: MAKES.map(([id, en, ar, classes]) => ({
    id, en, ar,
    classes: classes.map(([cid, cen, car, body, seats, fuel]) => ({ id: cid, en: cen, ar: car, body, seats, fuel })),
  })),
  colors: COLORS.map(([id, ar, hex]) => ({ id, ar, hex })),
  bodyAr: BODY_AR, fuelAr: FUEL_AR, transmissionAr: TRANSMISSION_AR,
};

const makeById = (id) => catalog.makes.find((m) => m.id === id) || null;
const classById = (makeId, classId) => { const m = makeById(makeId); return (m && m.classes.find((c) => c.id === classId)) || null; };
const colorById = (id) => catalog.colors.find((c) => c.id === id) || null;

module.exports = { catalog, makeById, classById, colorById, BODY_AR, FUEL_AR, TRANSMISSION_AR };
