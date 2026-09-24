/* أيقونات SVG خطية بأسلوب واحد — لا إيموجي، ولا مكتبات خارجية. */
window.Icon = (function () {
  const S = (p, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" width="22" height="22" ${extra}>${p}</svg>`;

  const paths = {
    back:     '<path d="M15 5l-7 7 7 7"/>',
    forward:  '<path d="M9 5l7 7-7 7"/>',
    close:    '<path d="M6 6l12 12M18 6L6 18"/>',
    search:   '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/>',
    menu:     '<path d="M4 7h16M4 12h16M4 17h16"/>',
    user:     '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0115 0"/>',
    home:     '<path d="M4 10.5L12 4l8 6.5"/><path d="M6 10v9h12v-9"/>',
    work:     '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5"/>',
    pin:      '<path d="M12 21s7-5.7 7-11a7 7 0 10-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    clock:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    star:     '<path d="M12 3.6l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.8l5.9-.9z" fill="currentColor" stroke="none"/>',
    starLine: '<path d="M12 3.6l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.8l5.9-.9z"/>',
    car:      '<path d="M5 16.5h14M6.5 16.5v1.8a1 1 0 01-1 1H4.8a1 1 0 01-1-1v-1.8M20.2 16.5v1.8a1 1 0 01-1 1h-.7a1 1 0 01-1-1v-1.8"/><path d="M4 16.5l1-4.6a2 2 0 011.6-1.5l.9-2.6A2 2 0 019.4 6.4h5.2a2 2 0 011.9 1.4l.9 2.6a2 2 0 011.6 1.5l1 4.6"/><path d="M6.3 10.6h11.4"/>',
    car2:     '<path d="M4 16.5h16M6.5 16.5v2H4.5v-2M19.5 16.5v2h-2v-2"/><path d="M4 16.5l1.2-5a2.4 2.4 0 012.3-1.8h9a2.4 2.4 0 012.3 1.8l1.2 5"/><circle cx="7.6" cy="13.8" r=".9" fill="currentColor" stroke="none"/><circle cx="16.4" cy="13.8" r=".9" fill="currentColor" stroke="none"/>',
    van:      '<path d="M3 16.5h18M6 16.5v2H4v-2M20 16.5v2h-2v-2"/><path d="M3 16.5V9.5a2 2 0 012-2h11l4 4.5v4.5"/><path d="M9 7.5v4M14 7.5v4M3 11.5h17"/>',
    phone:    '<path d="M6.5 4h3l1.4 3.6-2 1.4a12 12 0 006 6l1.4-2 3.6 1.4v3a1.6 1.6 0 01-1.8 1.6A15.6 15.6 0 014.9 5.8 1.6 1.6 0 016.5 4z"/>',
    chat:     '<path d="M20 12.5a7 7 0 01-7 7H7.8L4 21.5l1-3.6a7 7 0 1115-5.4z"/>',
    moon:     '<path d="M20 14.2A8.2 8.2 0 019.8 4a8.4 8.4 0 1010.2 10.2z"/>',
    sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.4a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7h-.2a2 2 0 110-4h.1a1.6 1.6 0 001.2-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V4a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
    logout:   '<path d="M15 5h3a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0118 19h-3"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    camera:   '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0120 18.5H4A1.5 1.5 0 012.5 17v-7A1.5 1.5 0 014 8.5z"/><circle cx="12" cy="13" r="3.2"/>',
    check:    '<path d="M5 12.5l4.5 4.5L19 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.8 2.8L16 9.5"/>',
    plus:     '<path d="M12 5v14M5 12h14"/>',
    trash:    '<path d="M4 7h16M9.5 7V5.5a1 1 0 011-1h3a1 1 0 011 1V7M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4L17.5 7"/>',
    receipt:  '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8.5h6M9 12.5h6"/>',
    bell:     '<path d="M18 16.5H6l1.2-2v-4a4.8 4.8 0 019.6 0v4z"/><path d="M10.2 19.5a2 2 0 003.6 0"/>',
    shield:   '<path d="M12 3.5l7 2.6v5.2c0 4.3-2.9 7.9-7 9.2-4.1-1.3-7-4.9-7-9.2V6.1z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
    navigate: '<path d="M12 3l7.5 17-7.5-4-7.5 4z"/>',
    crosshair:'<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
    wallet:   '<path d="M4 8.5A2.5 2.5 0 016.5 6H18a2 2 0 012 2v9a2 2 0 01-2 2H6.5A2.5 2.5 0 014 16.5z"/><path d="M4 8.5h16"/><circle cx="16.5" cy="13" r="1.2" fill="currentColor" stroke="none"/>',
    help:     '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 114 2.4c-.8.6-1.1 1-1.1 1.9"/><circle cx="12.5" cy="17" r=".9" fill="currentColor" stroke="none"/>',
    edit:     '<path d="M16.5 4.5l3 3L8 19H5v-3z"/>',
    share:    '<circle cx="17" cy="6" r="2.5"/><circle cx="7" cy="12" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M9.2 10.8l5.6-3.3M9.2 13.2l5.6 3.3"/>',
    alert:    '<path d="M12 4.5l8.5 15H3.5z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
    empty:    '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 11h17M8 6V3.5M16 6V3.5"/>',
    power:    '<path d="M12 3.5v8"/><path d="M7.2 6.3a7.5 7.5 0 109.6 0"/>',
    flag:     '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.2 4 2.2 4h-11"/>',
    target:   '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
    upload:   '<path d="M12 16V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15.5v2.5a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5v-2.5"/>',
    doc:      '<path d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9.5A1.5 1.5 0 015.5 19V5A1.5 1.5 0 017 3.5z"/><path d="M13.5 3.5V8H18M9 12.5h6M9 16h6"/>',
    chart:    '<path d="M4.5 19.5h15"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>',
    mic:      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>',
    swap:     '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  };

  return function Icon(name, size = 22, extra = '') {
    const p = paths[name] || paths.pin;
    return S(p, `width="${size}" height="${size}" ${extra}`);
  };
})();
