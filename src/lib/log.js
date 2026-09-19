'use strict';
const config = require('../config');

function emit(level, msg, fields = {}) {
  const line = { ts: new Date().toISOString(), level, msg, ...fields };
  const out = config.isProd ? JSON.stringify(line) : `[${level}] ${msg} ${Object.keys(fields).length ? JSON.stringify(fields) : ''}`;
  (level === 'error' ? console.error : console.log)(out);
}

module.exports = {
  info:  (m, f) => emit('info', m, f),
  warn:  (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
  debug: (m, f) => { if (!config.isProd) emit('debug', m, f); },
};
