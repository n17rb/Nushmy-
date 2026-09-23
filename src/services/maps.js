'use strict';
/**
 * مزوّد بلاطات الخريطة.
 *  1) MAP_TILES_URL من Render (أي مزوّد بدك ياه)
 *  2) مفتاح CARTO (من الإعدادات بلوحة الإدارة أو CARTO_API_KEY) ← ستايل رمادي هادي متل أوبر
 *  3) بدون أي مفتاح ← OpenStreetMap (مجاني، أسماء عربية) مع فلتر بيخليه هادي
 */
const config = require('../config');
const settings = require('./settings');

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

async function tiles() {
  const m = config.maps;
  if (m.tilesUrl) {
    return { tilesUrl: m.tilesUrl, tilesUrlDark: m.tilesUrlDark || m.tilesUrl, tilesStyle: 'custom', attribution: '&copy; OpenStreetMap' };
  }
  const key = m.cartoKey || (await settings.get('maps.carto_key')) || '';
  if (key) {
    const k = encodeURIComponent(String(key).trim());
    return {
      tilesUrl: `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${k}`,
      tilesUrlDark: `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${k}`,
      tilesStyle: 'carto', attribution: '&copy; OpenStreetMap &copy; CARTO',
    };
  }
  return { tilesUrl: OSM, tilesUrlDark: OSM, tilesStyle: 'osm', attribution: '&copy; OpenStreetMap' };
}

module.exports = { tiles };
