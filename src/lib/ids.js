'use strict';
const crypto = require('crypto');

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

/** كود رحلة قصير يسهل قراءته: NSH-7F3K2Q */
function tripCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return 'NSH-' + out;
}

module.exports = { uuid, nowIso, tripCode };
